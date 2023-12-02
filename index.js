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

            
    getBestCreatorByPrizeMoney: async (req, res) => {
      try {
        const result = await contestCollection.aggregate([
          {
            $match: { status: "accepted" },
          },
          {
            $group: {
              _id: "$creator",
              bestContest: { $first: "$$ROOT" }, // Retrieve the first contest for each creator
              totalPrizeMoney: { $sum: "$prizeMoney" },
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "_id",
              as: "creator",
            },
          },
          {
            $unwind: "$creator",
          },
          {
            $project: {
              _id: 0,
              creator: "$creator.name",
              image: "$creator.image",
              email: "$creator.email",
              bestContest: "$bestContest", // Include the details of the best contest
              totalPrizeMoney: 1,
            },
          },
          {
            $sort: { totalPrizeMoney: -1 },
          },
          {
            $limit: 5, // Limit the result to the top 5 creators with their best contests
          },
        ]).toArray();
  
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
  
        const result = await contestCollection.find({ participants: user._id }).toArray();
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
  
        const result = await contestCollection.find({ winner: user._id }).toArray();
        res.status(200).json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    },
  
    getContestByCreator: async (req, res) => {
      const id = req.params.creatorId;
      const email = req.decoded.email;
  
      const page = req.query.page * 1 || 1;
      const limit = req.query.limit * 1 || 10;
      const skip = (page - 1) * limit;
  
      try {
        const creator = await usersCollection.findOne({ email });
  
        if (
          !creator ||
          creator._id.toString() !== id ||
          creator.role !== "creator"
        ) {
          return res
            .status(403)
            .send({ message: "Access Denied: Insufficient Permission" });
        }
  
        const result = await contestCollection.find({ creator: id }).skip(skip).limit(limit).toArray();
        const total = await contestCollection.countDocuments({ creator: id });
  
        res.send({ contests: result, count: total });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    },
  
    getAllContestsForAdmin: async (req, res) => {
      const page = req.query.page * 1 || 1;
      const limit = req.query.limit * 1 || 10;
      const skip = (page - 1) * limit;
  
      try {
        const result = await contestCollection.find({})
          .skip(skip)
          .limit(limit)
          .toArray();
  
        const total = await contestCollection.countDocuments();
  
        res.send({ result, count: total });
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: error.message });
      }
    },
  
    createContest: async (req, res) => {
      try {
        const contest = req.body;
  
        const creator = await usersCollection.findOne({ _id: contest.creator, role: "creator" });
        if (!creator) {
          return res
            .status(403)
            .send({ message: "Access Denied: Insufficient Permission" });
        }
  
        const credits = creator?.credits || 0;
  
        if (credits < 50) {
          return res.status(400).send({ message: "Insufficient credits" });
        }
  
        // deduct 50 credits from the creator
        creator.credits = credits - 50;
        await usersCollection.updateOne({ _id: creator._id }, { $set: { credits: creator.credits } });
  
        const result = await contestCollection.insertOne(contest);
  
        res.status(201).send(result.ops[0]);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    },
  
    addParticipant: async (req, res) => {
      const contestId = req.params.contestId;
      const userId = req.params.userId;
  
      try {
        const contest = await contestCollection.findOne({ _id: toObjectId(contestId) });
        if (!contest) {
          return res.status(404).send({ message: "Contest not found" });
        }
  
        // check if the participant is already added
        const isParticipant = contest.participants.includes(userId);
        if (isParticipant) {
          return res.status(400).send({ message: "Participant already added" });
        }
  
        // added the participant
        await contestCollection.updateOne({ _id: contest._id }, { $push: { participants: userId } });
  
        res.status(200).send({ message: "Participant added successfully" });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    },

    declareWinner: async (req, res) => {
      const contestId = req.params.contestId;
      const email = req.decoded.email;
  
      try {
        const contest = await contestCollection.findOne({ _id: toObjectId(contestId) });
        if (!contest) {
          return res.status(404).send({ message: "Contest not found" });
        }
  
        // check if the contest is created by the creator
        if (contest.creator.toString() !== email) {
          return res.status(403).send({ message: "Access denied" });
        }
  
        // check if the contest is not closed yet
        if (contest.deadline > new Date()) {
          return res.status(400).send({ message: "Contest is not close yet" });
        }
  
        // check if the winner is already declared
        if (contest.winner) {
          return res.status(400).send({ message: "Winner already declared" });
        }
  
        // declare the winner
        await contestCollection.updateOne({ _id: contest._id }, { $set: { winner: req.body.winner } });
  
        res.status(200).send({ message: "Participant added successfully" });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    },
  
    updateContest: async (req, res) => {
      const id = req.params.id;
      const contest = req.body;
      const result = await contestCollection.updateOne({ _id: toObjectId(id) }, { $set: contest });
      res.send(result);
    },
  
    deleteContest: async (req, res) => {
      const id = req.params.id;
      const result = await contestCollection.deleteOne({ _id: toObjectId(id) });
      res.send(result);
    },
    getWinners: async (req, res) => {
      try {
        const contests = await contestCollection.find({
          status: "accepted",
          winner: { $ne: null },
        }).toArray();
  
        const winners = contests.map((contest) => {
          return {
            title: contest.title,
            image: contest.image,
            winner: contest.winner,
            prizeMoney: contest.prizeMoney,
            participantCount: contest?.participants?.length,
          };
        });
  
        res.status(200).json(winners);
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: error.message });
      }
    },
    getUserStats: async (req, res) => {
      const email = req.decoded?.email;
    
      if (!email) {
        return res.status(401).send({ message: 'Unauthorized access' });
      }
    
      try {
        const user = await userCollection.findOne({ email }, { _id: 1 });
        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }
    
        const contests = await contestCollection.find({
          participants: user._id,
          status: 'accepted',
        });
    
        const winningContests = contests.filter(
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
    app.get('/contests/best-creator', contestController.getBestCreatorByPrizeMoney);
    app.post('/contests/', verifyToken, contestController.createContest);
    app.get('/contests/registered', verifyToken, contestController.getRegisteredContest);
    app.get('/contests/winning', contestController.getWinningContest);
    app.patch('/contests/:id', verifyRole('creator', 'admin'), contestController.updateContest);
    app.delete('/contests/:id', verifyRole('creator', 'admin'), contestController.deleteContest);
    app.patch('/contests/:contestId/winner', verifyRole('creator'), contestController.declareWinner);
    app.get('/contests/winners', contestController.getWinners);
    app.get('/contests/user-stats', contestController.getUserStats);

    

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