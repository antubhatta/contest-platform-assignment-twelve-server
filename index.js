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

    const db = client.db('contestDB');

    const usersCollection = db.collection('users');
    const contestCollection = db.collection('contests');


    
    // -----------------------------------------
    //************** MIDDLEWARES****************
    // -----------------------------------------
    
    // verify the token
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'Unauthorized Access' });
      }
    
      const token = req.headers.authorization.split(' ')[1] || null;
      if (!token) {
        return res.status(401).send({ message: 'Unauthorized Access' });
      }
    
      // If there is a token, verify it
      jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: 'Unauthorized Access' });
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
          res.status(403).json({ message: "You don't have permission to access" });
        }
      };
    };

    // -----------------------------------------
    //************** CONTROLLERS****************
    // -----------------------------------------

    // Auth Controller
    const authController = {
      createToken: async (req, res) => {
        const user = req.body;
        console.log("I need a new jwt", user);
        const token = jwt.sign(user, process.env.JWT_SECRET, {
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
              sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
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
          const page = req.query.page * 1 || 1;
          const limit = req.query.limit * 1 || 10;
          const skip = (page - 1) * limit;
    
          const users = await usersCollection.find({}).skip(skip).limit(limit).toArray();
          const total = await usersCollection.countDocuments();
          res.send({ users, count: total });
        } catch (error) {
          res.send(error);
        }
      },
    
      getUserByEmail: async (req, res) => {
        const email = req.params.email;
        const result = await usersCollection.findOne({ email });
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
        res.send(result.ops[0]);
      },
    
      updateUser: async (req, res) => {
        const id = req.params.id;
        const user = req.body;
        const result = await usersCollection.updateOne({ _id: ObjectId(id) }, { $set: user });
        res.send(result);
      },
    
    };

    // Contest Controller
    const contestController = {
          getAllContests: async (req, res) => {
              try {
                const searchText = req.query.search || "";
          
                const result = await contestCollection.aggregate([
                  {
                    $match: {
                      status: "accepted",
                      type: { $regex: searchText, $options: "i" },
                    },
                  },
                  {
                    $project: {
                      title: 1,
                      type: 1,
                      image: 1,
                      description: 1,
                      participantsCount: { $size: "$participants" },
                    },
                  },
                  {
                    $sort: { participantsCount: -1 },
                  },
                ]).toArray();
          
                res.status(200).json(result);
              } catch (error) {
                res.status(500).json({ error: error.message });
              }
            },
          
            getContestById: async (req, res) => {
              try {
                const id = req.params.id;
          
                const result = await contestCollection.findOne({ _id: toObjectId(id) });
                const winner = await usersCollection.findOne({ _id: toObjectId(result.winner) });
          
                result.winner = winner;
          
                res.send(result);
              } catch (error) {
                res.status(500).send(error);
              }
            },
          
            getContestByIdForCreators: async (req, res) => {
              const contestId = req.params.contestId;
              const creatorId = req.params.creatorId;
          
              try {
                const contest = await contestCollection.findOne({ _id: toObjectId(contestId) });
                const creator = await usersCollection.findOne({ _id: toObjectId(creatorId) });
          
                if (!contest) {
                  return res.status(404).send({ message: "Contest not found" });
                }
          
                // Check if the logged-in user is the creator of the contest
                if (contest.creator.toString() !== creatorId) {
                  return res.status(403).send({ message: "Access denied" });
                }
          
                const tasks = await taskCollection.find({ contestId: contestId }).toArray();
          
                const participantsWithTasks = contest.participants.map((participant) => {
                  const participantTask = tasks.find((task) =>
                    task.participantId.equals(participant)
                  );
          
                  return {
                    _id: participant,
                    name: participantTask ? participantTask.task : null,
                  };
                });
          
                const formattedContest = {
                  _id: contest._id,
                  title: contest.title,
                  description: contest.description,
                  deadline: contest.deadline,
                  prizeMoney: contest.prizeMoney,
                  winner: contest.winner,
                  participants: participantsWithTasks,
                };
          
                res.status(200).send(formattedContest);
              } catch (error) {
                res
                  .status(500)
                  .send({ message: error?.message || "Internal server error" });
              }
            },
          
            getPopularContests: async (req, res) => {
              try {
                const result = await contestCollection.aggregate([
                  { $match: { status: "accepted" } },
                  {
                    $project: {
                      title: 1,
                      type: 1,
                      image: 1,
                      description: 1,
                      participantsCount: { $size: "$participants" },
                    },
                  },
                  {
                    $sort: { participantsCount: -1 },
                  },
                  { $limit: 6 },
                ]).toArray();
          
                res.status(200).json(result);
              } catch (error) {
                res.status(500).json({ error: error.message });
              }
            },
      }

          
    // -----------------------------------------
    //************** ROUTERS ****************
    // -----------------------------------------
    // Authentication Routes
    app.post("/auth/jwt", authController.createToken);
    app.get("/auth/logout", authController.logout);

    // Users Routes
    app.get("/users/:email", userController.getUserByEmail);
    app.post("/users/:email", userController.createUser);
    app.patch("/users/:id",verifyRole("admin"), userController.updateUser);
    app.get("/users", verifyRole("admin"), userController.getAllUsers);

    // Contest Routes
    app.get('/contests/', contestController.getAllContests);
    app.get('/contests/:id', contestController.getContestById);
    app.get('/contests/popular', contestController.getPopularContests);
    app.get('/contests/admin', verifyRole('admin'), verifyToken, contestController.getAllContestsForAdmin);
    app.get('/contests/creator/:creatorId', verifyRole('admin', 'creator'),  contestController.getContestByCreator);
    



    

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