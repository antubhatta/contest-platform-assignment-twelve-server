const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();

// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "https://win-wave-12.firebaseapp.com", "https://win-wave-12.web.app"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

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
    // await client.connect();

    const db = client.db("contestDB");

    const usersCollection = db.collection("users");
    const contestCollection = db.collection("contests");
    const taskCollection = db.collection("tasks");

    // -----------------------------------------
    //************** MIDDLEWARES****************
    // -----------------------------------------

    // verify the token
    const verifyToken = async (req, res, next) => {
      const token = req.cookies?.token;
      console.log(token);
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          console.log(err);
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // Verify the role
    const verifyRole = (...roles) => {
      return async (req, res, next) => {
        const email = req.decoded.email;

        const user = await User.findOne({ email });

        if (user && roles.includes(user.role)) {
          next();
        } else {
          res
            .status(403)
            .json({ message: "You don't have permission to access" });
        }
      };
    };

    const createPaymentIntent = async (req, res) => {
      const { amount } = req.body;

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: parseInt(amount * 100),
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    };

    // -----------------------------------------
    //************** CONTROLLERS****************
    // -----------------------------------------

    // Auth Controller
    const authController = {
      createToken: async (req, res) => {
        const user = req.body;
        console.log("I need a new jwt", user);
        const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: process.env.JWT_EXPIRES_IN,
        });
        res
          .cookie("token", token, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
          })
          .send({ success: true });
      },

      logout: async (req, res) => {
        try {
          res
            .clearCookie("token", {
              maxAge: 0,
              secure: process.env.NODE_ENV === "production",
              sameSite:
                process.env.NODE_ENV === "production" ? "none" : "strict",
            })
            .send({ success: true });
          console.log("Logout successful");
        } catch (err) {
          res.status(500).send(err);
        }
      },
    };

    const userController = {
      getAllUsers: async (req, res) => {
        try {


          const users = await usersCollection
            .find({})
            .toArray();
          const total = await usersCollection.countDocuments();
          res.send({ users, count: total });
        } catch (error) {
          res.send(error);
        }
      },

      getUserByEmail: async (req, res) => {
        const email = req.params.email;
        console.log(email);
        const result = await usersCollection.findOne({ email });
        console.log(result);
        res.send(result);
      },

      createUser: async (req, res) => {
        const email = req.params.email;
        const user = req.body;
        const query = { email: email };
        const isExist = await usersCollection.findOne(query);

        console.log("User found?----->", isExist);

        if (isExist) return res.send(isExist);

        const result = await usersCollection.insertOne(user);
        res.send(result);
      },

      updateUser: async (req, res) => {
        const id = req.params.id;
        const user = req.body;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: user }
        );
        res.send(result);
      },

      deleteUser: async (req, res) => {
        const id = req.params.id;
        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      },
    };

    // Contest Controller
    const contestController = {
      getAllContests: async (req, res) => {
        try {
          const result = await contestCollection
            .aggregate([
              {
                $match: {
                  status: "accepted",
                },
              },
              {
                $project: {
                  title: 1,
                  type: 1,
                  image: 1,
                  description: 1,
                  participantsCount: {
                    $size: { $ifNull: ["$participants", []] },
                  },
                },
              },
            ])
            .toArray();

          console.log(result);

          res.status(200).json(result);
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      },

      getContestById: async (req, res) => {
        try {
          const id = req.params.id;

          const result = await contestCollection.findOne({
            _id: new ObjectId(id),
          });
          const winner = await usersCollection.findOne({
            _id: new ObjectId(result.winner),
          });
          const creator = await usersCollection.findOne({
            _id: new ObjectId(result.creator),
          });

          result.winner = winner;
          result.creator = creator;

          res.send(result);
        } catch (error) {
          res.status(500).send(error);
        }
      },
      getContestByIdForCreators: async (req, res) => {
        const contestId = req.params.contestId;
        const creatorId = req.params.creatorId;

        try {
          const contest = await contestCollection.findOne({
            _id: new ObjectId(contestId),
          });

          const usersPromises = contest.participants.map(
            async (pId) =>
              await usersCollection.findOne({ _id: new ObjectId(pId) })
          );

          const winner = await usersCollection.findOne({
            _id: new ObjectId(contest.winner),
          });

          const users = await Promise.all(usersPromises);

          contest.participants = users;
          contest.winner = winner;

          res.status(200).send(contest);
        } catch (error) {
          res
            .status(500)
            .send({ message: error?.message || "Internal server error" });
        }
      },

      getPopularContests: async (req, res) => {
        try {
          const result = await contestCollection
            .aggregate([
              { $match: { status: "accepted" } },
              {
                $project: {
                  title: 1,
                  type: 1,
                  image: 1,
                  description: 1,
                  participantsCount: {
                    $size: { $ifNull: ["$participants", []] },
                  },
                },
              },
              {
                $sort: { participantsCount: -1 },
              },
              { $limit: 5 },
            ])
            .toArray();

          res.status(200).json(result);
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      },

      getBestCreatorByPrizeMoney: async (req, res) => {
        try {
          const result = await contestCollection
            .aggregate([
              {
                $match: {
                  status: "accepted",
                },
              },
              {
                $project: {
                  title: 1,
                  type: 1,
                  creator: 1,
                  image: 1,
                  description: 1,
                  creatorInfo: 1,
                  participantsCount: {
                    $size: { $ifNull: ["$participants", []] },
                  },
                },
              },
              {
                $sort: { participantsCount: -1 },
              },
              { $limit: 5 },
            ])
            .toArray();

          const creators = result.map(async (contest) => {
            const creator = await usersCollection.findOne({
              _id: new ObjectId(contest.creator),
            });


            contest.creatorInfo = creator;
          });

          await Promise.all(creators);

          res.status(200).json(result);
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      },

      getRegisteredContest: async (req, res) => {
        try {
          const email = req.decoded.email;
          const user = await usersCollection.findOne({ email });

          if (!user || user.role !== "user") {
            return res
              .status(403)
              .send({ message: "Access Denied: Insufficient Permission" });
          }

          const result = await contestCollection
            .find({
              participants: {
                $in: [user._id.toString()],
              },
            })
            .toArray();
          res.status(200).json(result);
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      },

      getWinningContest: async (req, res) => {
        try {
          const email = req.decoded.email;
          const user = await usersCollection.findOne({ email });

          if (!user || user.role !== "user") {
            return res
              .status(403)
              .send({ message: "Access Denied: Insufficient Permission" });
          }

          const result = await contestCollection
            .find({ winner: user._id.toString() })
            .toArray();
          res.status(200).json(result);
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      },

      getContestByCreator: async (req, res) => {
        try {
          const id = req.params.creatorId;
          const email = req.decoded.email;

          await usersCollection.findOne({ email });

          const result = await contestCollection
            .find({ creator: id })
            .toArray();
          const total = await contestCollection.countDocuments({ creator: id });

          res.send({ contests: result, count: total });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      },

      getAllContestsForAdmin: async (req, res) => {
        try {


          const result = await contestCollection
            .find({})
            .toArray();

          const total = await contestCollection.countDocuments();

          res.send({ result, count: total });
        } catch (error) {
          console.log(error);
          res.status(500).send(error);
        }
      },

      createContest: async (req, res) => {
        try {
          const contest = req.body;
          console.log(req.body);

          const creator = await usersCollection.findOne({
            _id: new ObjectId(contest.creator),
            role: "creator",
          });
          if (!creator) {
            return res
              .status(403)
              .send({ message: "Access Denied: Insufficient Permission" });
          }

          await usersCollection.updateOne(
            { _id: creator._id },
            { $set: { credits: creator.credits } }
          );

          const result = await contestCollection.insertOne(contest);

          res.status(201).send(result);
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      },

      addParticipant: async (req, res) => {
        const contestId = req.params.contestId;
        const userId = req.params.userId;

        try {
          const contest = await contestCollection.findOne({
            _id: new ObjectId(contestId),
          });
          if (!contest) {
            return res.status(404).send({ message: "Contest not found" });
          }

          // check if the participant is already added
          const isParticipant = contest?.participants?.includes(userId);
          if (isParticipant) {
            return res
              .status(400)
              .send({ message: "Participant already added" });
          }

          // added the participant
          await contestCollection.updateOne(
            { _id: contest._id },
            { $push: { participants: userId } }
          );

          res.status(200).send({ message: "Participant added successfully" });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      },

      declareWinner: async (req, res) => {
        const contestId = req.params.contestId;
        const email = req.decoded.email;

        try {
          const contest = await contestCollection.findOne({
            _id: new ObjectId(contestId),
          });
          if (!contest) {
            return res.status(404).send({ message: "Contest not found" });
          }

          // check if the contest is not closed yet
          if (contest.deadline > new Date()) {
            return res
              .status(400)
              .send({ message: "Contest is not close yet" });
          }

          // check if the winner is already declared
          if (contest.winner) {
            return res.status(400).send({ message: "Winner already declared" });
          }

          // declare the winner
          await contestCollection.updateOne(
            { _id: contest._id },
            { $set: { winner: req.body.winner } }
          );

          res.status(200).send({ message: "winner declared successfully" });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      },

      updateContest: async (req, res) => {
        const id = req.params.id;
        const contest = req.body;
        const result = await contestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: contest }
        );
        res.send(result);
      },

      deleteContest: async (req, res) => {
        const id = req.params.id;
        const result = await contestCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      },

      getWinners: async (req, res) => {
        try {
          const result = await contestCollection
            .aggregate([
              {
                $match: {
                  status: "accepted",
                  winner: { $ne: null },
                },
              },
              {
                $project: {
                  title: 1,
                  type: 1,
                  winner: 1,
                  image: 1,
                  description: 1,
                  creatorInfo: 1,
                  participantsCount: {
                    $size: { $ifNull: ["$participants", []] },
                  },
                },
              },
              {
                $sort: { participantsCount: -1 },
              },
              { $limit: 5 },
            ])
            .toArray();

          const creators = result.map(async (contest) => {
            const creator = await usersCollection.findOne({
              _id: new ObjectId(contest.winner),
            });

            contest.winnerInfo = creator;
          });

          await Promise.all(creators);

          res.status(200).json(result);
        } catch (error) {
          console.log(error);
          res.status(500).json({ error: error.message });
        }
      },
      getLeaderboard: async (req, res) => {
        console.log("getLeaderboard");
        try {
          const users = await contestCollection
            .aggregate([
              {
                $match: { status: "accepted", winner: { $ne: null } },
              },
              {
                $group: {
                  _id: "$winner",
                  // totalPrizeMoney: { $sum: "$prizeMoney" },
                },
              },
              // {
              //   $lookup: {
              //     from: "users",
              //     localField: "winner",
              //     foreignField: "_id",
              //     as: "winner",
              //   },
              // },
              // {
              //   $unwind: "$winner",
              // },
              // {
              //   $project: {
              //     _id: 0,
              //     winner: "$winner.name",
              //     image: "$winner.image",
              //     email: "$winner.email",
              //     totalPrizeMoney: 1,
              //   },
              // },
              // {
              //   $sort: { totalPrizeMoney: -1 },
              // },
              // {
              //   $limit: 20,
              // },
            ])
            .toArray();

          res.status(200).send(users);
        } catch (error) {
          res.status(500).send(error);
        }
      },
      getUserStats: async (req, res) => {
        const email = req.decoded?.email;

        if (!email) {
          return res.status(401).send({ message: "Unauthorized access" });
        }

        try {
          const user = await userCollection.findOne({ email }, { _id: 1 });
          if (!user) {
            return res.status(404).send({ message: "User not found" });
          }

          const contests = await contestCollection.find({
            participants: user._id,
            status: "accepted",
          });

          const winningContests =
            contests.filter(
              (contest) => contest.winner?.toString() === user._id.toString()
            ) || [];

          const stats = {
            totalContests: contests.length,
            totalFee: contests.reduce((acc, curr) => acc + curr.entryFee, 0),
            totalPrizeMoney: winningContests.reduce(
              (acc, curr) => acc + curr.prizeMoney,
              0
            ),
            totalWinningContests: winningContests.length,
          };

          res.status(200).send(stats);
        } catch (error) {
          console.log(error);
          res.status(500).send(error);
        }
      },
    };

    // Task Controller
    const taskController = {
      getTaskById: async (req, res) => {
        const email = req.decoded.email;
        const contestId = req.params.contestId;

        try {
          const participant = await usersCollection.findOne({ email });

          if (!participant || participant.role !== "user") {
            return res
              .status(403)
              .send({ message: "Access Denied: Insufficient Permission" });
          }

          const task = await taskCollection.findOne({
            contestId,
          });

          console.log(task);

          res.status(200).json(task);
        } catch (error) {
          console.log(error);
          res.status(500).send(error);
        }
      },

      createTask: async (req, res) => {
        const email = req.decoded.email;
        const contestId = req.params.contestId;

        try {
          const participant = await usersCollection.findOne({ email });
          if (!participant || participant.role !== "user") {
            return res
              .status(403)
              .send({ message: "Access Denied: Insufficient Permission" });
          }

          // check if already submitted
          const isAlreadySubmitted = await taskCollection.findOne({
            contestId,
            participantId: participant._id,
          });

          if (isAlreadySubmitted) {
            return res.status(403).send({ message: "Already Submitted" });
          }

          // create task
          const task = await taskCollection.insertOne({
            task: req.body.task,
            contestId,
            participantId: participant._id,
          });

          res.status(201).json(task);
        } catch (error) {
          res.status(500).send(error);
        }
      },
    };

    // -----------------------------------------
    //************** ROUTERS ****************
    // -----------------------------------------

    // Payment Routes
    app.post("/create-payment-intend", createPaymentIntent);

    // Authentication Routes
    app.post("/jwt", authController.createToken);
    app.get("/logout", authController.logout);

    // Users Routes
    app.get("/users/:email", userController.getUserByEmail);
    app.post("/users/:email", userController.createUser);
    app.patch("/users/:id", userController.updateUser);
    app.delete("/users/:id", userController.deleteUser);
    app.get("/users", userController.getAllUsers);

    // Contest Routes
    app.get(
      "/contests/admin",
      verifyToken,
      contestController.getAllContestsForAdmin
    );
    app.get(
      "/contests/creator/:creatorId",
      verifyToken,
      contestController.getContestByCreator
    );
    app.get(
      "/contests/registered",
      verifyToken,
      contestController.getRegisteredContest
    );
    app.get("/contests/popular", contestController.getPopularContests);
    app.get(
      "/contests/best-creator",
      contestController.getBestCreatorByPrizeMoney
    );
    app.get("/contests/winners", contestController.getWinners);
    app.get("/contests/leaderboard", contestController.getLeaderboard);
    app.get("/contests/", contestController.getAllContests);
    app.post("/contests/", verifyToken, contestController.createContest);
    app.get(
      "/contests/winning",
      verifyToken,
      contestController.getWinningContest
    );
    app.get("/contests/user-stats", contestController.getUserStats);
    app.get("/contests/:id", contestController.getContestById);
    app.patch("/contests/:id", contestController.updateContest);
    app.delete("/contests/:id", contestController.deleteContest);
    app.get(
      "/contests/:contestId/creator/:creatorId",
      contestController.getContestByIdForCreators
    );
    app.patch(
      "/contests/:contestId/winner",
      verifyToken,
      contestController.declareWinner
    );
    app.patch(
      "/contests/:contestId/participant/:userId",
      contestController.addParticipant
    );

    // Task Routes
    app.get(
      "/tasks/contests/:contestId",
      verifyToken,
      taskController.getTaskById
    );
    app.post(
      "/tasks/contests/:contestId",
      verifyToken,
      taskController.createTask
    );

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
