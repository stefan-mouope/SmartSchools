// modules/registration/evnts/rabbitmq.ts
import amqp from "amqplib";
import { v4 as uuidv4 } from "uuid";

let channel: amqp.Channel | null = null;
let replyQueue: string = "";
const pendingResponses = new Map<
  string,
  { resolve: (value: any) => void; reject: (err: any) => void }
>();

export const connectRabbitMQ = async (): Promise<void> => {
  if (channel) return;

  const connection = await amqp.connect("amqp://localhost");
  channel = await connection.createChannel();

  // Exchange commun à tous les services
  await channel.assertExchange("inscription_events", "topic", { durable: false });

  // REPLY QUEUE EXCLUSIVE (indispensable pour le pattern RPC)
  const q = await channel.assertQueue("", { exclusive: true });
  replyQueue = q.queue;

  console.log("ReplyQueue créée pour RPC :", replyQueue);

  // On consomme les réponses (même si on n'en attend pas ici, ça vide la queue)
  channel.consume(
    replyQueue,
    (msg) => {
      if (!msg) return;

      const correlationId = msg.properties.correlationId;
      if (!correlationId) return;

      const pending = pendingResponses.get(correlationId);
      if (pending) {
        try {
          pending.resolve(JSON.parse(msg.content.toString()));
        } catch (err) {
          pending.reject(err);
        } finally {
          pendingResponses.delete(correlationId);
        }
      }
      channel!.ack(msg);
    },
    { noAck: false }
  );

  console.log("RabbitMQ connecté + RPC prêt (replyQueue:", replyQueue, ")");
};

export const getChannel = (): amqp.Channel => {
  if (!channel) throw new Error("RabbitMQ non connecté. Appelez connectRabbitMQ() d'abord.");
  return channel;
};

export const getReplyQueue = (): string => {
  if (!replyQueue) throw new Error("Reply queue non initialisée");
  return replyQueue;
};

// Fonction utilitaire pour faire des appels RPC depuis registration (bonus)
export const callRpc = async (routingKey: string, data: any, timeoutMs = 10000) => {
  const correlationId = uuidv4();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResponses.delete(correlationId);
      reject(new Error("RPC Timeout"));
    }, timeoutMs);

    pendingResponses.set(correlationId, {
      resolve: (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      reject,
    });

    getChannel().publish(
      "inscription_events",
      routingKey,
      Buffer.from(JSON.stringify({ data })),
      {
        correlationId,
        replyTo: getReplyQueue(),
      }
    );
  });
};

// Consumer générique (inchangé, sauf qu’on passe le channel correctement)
export const consumeEvent = async (
  routingKey: string,
  queueName: string,
  handler: (event: any, msg: amqp.ConsumeMessage, channel: amqp.Channel) => Promise<void>
) => {
  const ch = getChannel();
  await ch.assertQueue(queueName, { durable: false });
  await ch.bindQueue(queueName, "inscription_events", routingKey);

  console.log(`Consumer prêt → queue: ${queueName} | routingKey: ${routingKey}`);

  ch.consume(
    queueName,
    async (msg) => {
      if (!msg) return;
      try {
        const event = JSON.parse(msg.content.toString());
        await handler(event, msg, ch);
        // ack déplacé dans le handler (plus sûr)
      } catch (err) {
        console.error("Erreur dans le consumer :", err);
        ch.nack(msg, false, false);
      }
    },
    { noAck: false }
  );
};