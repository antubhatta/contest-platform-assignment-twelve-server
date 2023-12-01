const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();

// middlewares
app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URL;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("contestDB");

    // AUTHENTICATION

    // generate a new token
    app.post("/jwt", async (req, res) => {
      const body = req.body;
      const token = jwt.sign(body, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // verify the token
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }

      const token = req.headers["authorization"].split(" ")[1] || null;
      if (!token) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }

      // If there is a token, verify it
      jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Unauthorized Access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // verify the admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      const isAdmin = result && result.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

    // payment
    app.post("/create-payment-intend", async (req, res) => {
      const { total } = req.body;

      // create a payment intent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: parseInt(total * 100),
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Users Collection
    const usersCollection = db.collection("users");

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find({}).toArray();
      res.send(result);
    });

    // check admin
    app.get("/users/admin", verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      let isAdmin = false;
      if (result && result.role === "admin") {
        isAdmin = true;
      }
      res.send({ isAdmin });
    });

    app.post("/users", async (req, res) => {
      const body = req.body;

      const isAlreadyExist = await usersCollection.findOne({
        email: body.email,
      });
      if (isAlreadyExist) {
        return res.send({ message: "User already exists" });
      }

      const result = await usersCollection.insertOne(body);
      res.send(result);
    });

    app.patch("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const body = req.body;
      const query = { _id: new ObjectId(id) };
      const update = { $set: body };
      const options = { upsert: false };
      const result = await usersCollection.updateOne(query, update, options);
      res.send(result);
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});