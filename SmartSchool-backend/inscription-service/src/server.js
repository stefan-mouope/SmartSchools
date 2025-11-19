import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import sequelize from "./config/db.js";
import { Student, Inscription, Tranche, Payer } from "./models/associations.js";
import eurekaClient from "./eureka/eurekaClient.js";
import { connectRabbitMQ } from "./config/rabbitmq.js";
import { startVerifyInscriptionConsumer } from "./consumers/verifyInscriptionConsumer.js";

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    await Student.sync({ alter: true });
    await Tranche.sync({ alter: true });
    await Inscription.sync({ alter: true });
    await Payer.sync({ alter: true });

    console.log("🗄️  Modèles synchronisés avec la base de données.");

    // D'abord : connexion à RabbitMQ
    console.log("⏳ Connexion à RabbitMQ...");
    await connectRabbitMQ();
    console.log("🐇 RabbitMQ connecté.");

    // Ensuite : démarrer les consumers
    console.log("⏳ Démarrage du consumer verifyInscription...");
    await startVerifyInscriptionConsumer();
    console.log("👂 Consumer verifyInscription démarré.");

    // Ensuite seulement : démarrer le serveur HTTP
    app.listen(PORT, () => {
      console.log(`🚀 Service Inscription démarré sur le port ${PORT}`);

      // Enfin : Eureka
      eurekaClient.start(error => {
        if (error) console.error("❌ Erreur Eureka :", error);
        else console.log("✅ Service enregistré sur Eureka !");
      });
    });

    process.on("SIGINT", () => {
      console.log("\n🛑 Arrêt du service...");
      eurekaClient.stop(() => {
        console.log("🧼 Service désenregistré d’Eureka");
        process.exit(0);
      });
    });

  } catch (error) {
    console.error("❌ Erreur au démarrage du service :", error);
  }
})();
