import amqp from "amqplib";
import { v4 as uuidv4 } from "uuid";

let channel;
let replyQueue;
const pendingResponses = new Map();

export const connectRabbitMQ = async () => {
  const connection = await amqp.connect("amqp://localhost");
  channel = await connection.createChannel();

  await channel.assertExchange("inscription_events", "topic", { durable: false });

  // Queue de réponse exclusive (RPC)
  replyQueue = await channel.assertQueue("", { exclusive: true });

  console.log("✅ RabbitMQ connecté - reply queue :", replyQueue.queue);

  // Reception des réponses RPC
  channel.consume(
    replyQueue.queue,
    (msg) => {
      const correlationId = msg.properties.correlationId;
      if (!correlationId) return;

      const pending = pendingResponses.get(correlationId);
      if (pending) {
        pending.resolve(JSON.parse(msg.content.toString()));
        pendingResponses.delete(correlationId);
      }
    },
    { noAck: true }
  );
};

/**
 * Publish pour RPC
 */
export const publishEvent = async (event, routingKey = "inscription.request") => {
  if (!channel) throw new Error("RabbitMQ non initialisé");

  const correlationId = uuidv4();

  const promise = new Promise((resolve) => {
    pendingResponses.set(correlationId, { resolve });

    channel.publish(
      "inscription_events",
      routingKey,
      Buffer.from(JSON.stringify(event)),
      { replyTo: replyQueue.queue, correlationId }
    );

    console.log("📤 Event envoyé :", event);
  });

  return promise;
};

/**
 * Consumer générique
 */
export const consumeEvent = async (routingKey, queueName, callback) => {
  await channel.assertQueue(queueName);

  channel.bindQueue(queueName, "inscription_events", routingKey);

  console.log("👂 Consumer prêt :", queueName, "->", routingKey);

  channel.consume(queueName, async (msg) => {
    const content = JSON.parse(msg.content.toString());
    await callback(content, msg, channel);
  });
};
