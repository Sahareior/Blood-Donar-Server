const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const { Server } = require('socket.io'); // Import Socket.IO
const http = require('http');

const app = express();
const port = process.env.PORT || 5000;

const server = http.createServer(app); // Create HTTP server
const io = require('socket.io')(server, {
  cors: {
    origin: '*',
  }
});

const corsOptions = {
  origin: 'http://localhost:5173',
  methods: ['GET', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Allow credentials
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

async function startServer() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db('Donation');
    const Doners = db.collection("Doners");
    const conversationsCollection = db.collection('Conversations');
    const messagesCollection = db.collection('Messages');
    const userCollections = db.collection('Users')

    // Existing POST route handlers
    app.post('/user', async (req, res) => {
      const { displayName, photoURL, email, phoneNumber, uid } = req.body;

      try {
        if (!uid) {
          return res.status(400).json({ message: 'User ID (uid) is required' });
        }

        const result = await userCollections.updateOne(
          { uid },
          { $set: { displayName, photoURL, email, phoneNumber } },
          { upsert: true }
        );

        if (result.upsertedCount > 0) {
          res.status(201).json({ message: 'User created successfully' });
        } else if (result.matchedCount > 0) {
          res.status(200).json({ message: 'User updated successfully' });
        } else {
          res.status(404).json({ message: 'User not found' });
        }
      } catch (err) {
        console.error('Error creating/updating user:', err);
        res.status(500).json({ message: 'Error creating/updating user' });
      }
    });

    app.get('/users', async (req, res) => {
      const user = await userCollections.find().toArray();
      res.send(user);
    });

    app.get('/donors', async (req, res) => {
      try {
        const data = await Doners.find().toArray();
        res.send(data);
      } catch (err) {
        console.error('Error fetching SEO data:', err);
        res.status(500).send('Error fetching SEO data.');
      }
    });

    app.post('/conversations', async (req, res) => {
      const { userId, donorId } = req.body;

      try {
        const existingConversation = await conversationsCollection.findOne({
          members: { $all: [userId, donorId] }
        });

        if (existingConversation) {
          return res.status(200).json(existingConversation);
        }

        const newConversation = {
          members: [userId, donorId],
          createdAt: new Date(),
        };

        const result = await conversationsCollection.insertOne(newConversation);
        const savedConversation = await conversationsCollection.findOne({
          _id: result.insertedId,
        });

        res.status(201).json(savedConversation);
      } catch (err) {
        console.error('Error creating conversation:', err);
        res.status(500).send('Error creating conversation.');
      }
    });

    app.get('/conversations', async (req, res) => {
      const { userId, donorId } = req.query;

      try {
        const existingConversation = await conversationsCollection.findOne({
          members: { $all: [userId, donorId] }
        });

        if (existingConversation) {
          return res.status(200).json(existingConversation);
        } else {
          return res.status(404).json({ message: 'No conversation found' });
        }
      } catch (err) {
        console.error('Error fetching conversation:', err);
        res.status(500).send('Error fetching conversation.');
      }
    });

    app.post('/messages', async (req, res) => {
      try {
        const { conversationId, senderId, content } = req.body;

        const result = await messagesCollection.insertOne({
          conversationId,
          senderId,
          content,
          timestamp: new Date(),
        });

        const newMessage = await messagesCollection.findOne({
          _id: result.insertedId,
        });

        res.status(201).json(newMessage);
      } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).send('Error sending message.');
      }
    });

    app.get('/messages/:conversationId', async (req, res) => {
      try {
        const { conversationId } = req.params;

        const messages = await messagesCollection.find({ conversationId }).toArray();

        res.json(messages);
      } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).send('Error fetching messages.');
      }
    });

    // Socket.IO setup
    let users = [];

    const addUser = (userData, socketId) => {
      if (!users.some(user => user.uid === userData.uid)) {
        users.push({ ...userData, socketId });
      }
      console.log("Users Array:", users);
    }
    

    const removeUser = (socketId) => {
      users = users.filter(user => user.socketId !== socketId);
    };

    const getUser = (userId) => {
      const user = users.find(user => user.uid === userId);
      if (!user) {
        console.error(`User with ID ${userId} not found`);
      }
      return user;
    }
    

    io.on('connection', (socket) => {
      console.log('user connected');

      // connect
      socket.on("addUser", userData => {
        addUser(userData, socket.id);
        io.emit("getUsers", users);
      });

      socket.on('sendMessage', (data) => {
        const user = getUser(data.receiverId);
        if (user) {
          io.to(user.socketId).emit('getMessage', data);
        } else {
          console.error(`Socket ID for user ${data.receiverId} not found`);
        }
      });

      // disconnect
      socket.on('disconnect', () => {
        console.log('user disconnected');
        removeUser(socket.id);
        io.emit('getUsers', users);
      });
    });

  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}

startServer().catch(console.dir);

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
