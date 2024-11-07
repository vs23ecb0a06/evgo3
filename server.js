const express = require('express');
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const WebSocket = require('ws');
const app = express();

const port = process.env.PORT || 3000; // Adjust port for Render deployment

app.use(bodyParser.json());
app.use(cors());

// MongoDB connection string (hardcoded for this example, but should be secured for production)
const uri = "mongodb+srv://vedvis05:Ved%40180605@credentials.ba56l.mongodb.net/evgo?retryWrites=true&w=majority";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function connectDB() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
}

const wss = new WebSocket.Server({ noServer: true });
let userSocket = null;
let driverSockets = [];

wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');

  ws.on('message', (message) => {
    console.log(`Received message: ${message}`);
    const data = JSON.parse(message);

    // Handle different message types
    if (data.type === 'user') {
      userSocket = ws;
      console.log('User connected');
    } else if (data.type === 'driver') {
      driverSockets.push(ws);
      console.log('Driver connected');
    } else if (data.type === 'requestEV') {
      console.log('EV request received:', data);

      // Broadcast the request to all connected drivers
      driverSockets.forEach(driver => {
        if (driver.readyState === WebSocket.OPEN) {
          driver.send(JSON.stringify({
            type: 'newRequest',
            location: data.location,
            userId: data.userId,
            pickupLocation: data.pickupLocation
          }));
        }
      });

      // Acknowledge to the user (optional)
      if (userSocket && userSocket.readyState === WebSocket.OPEN) {
        userSocket.send(JSON.stringify({
          type: 'EVResponse',
          status: 'success',
          message: 'Your request has been sent to available drivers.'
        }));
      }
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    driverSockets = driverSockets.filter(driver => driver !== ws);
    if (ws === userSocket) userSocket = null;
  });
});

const server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  connectDB();
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Routes
app.post('/api/logout', (req, res) => {
  // Handle logout logic (e.g., destroy session or token)
  res.status(200).send({ message: 'Logged out successfully' });
});

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  const database = client.db("evgo");
  const users = database.collection("users");

  const existingUser = await users.findOne({ email });
  if (existingUser) return res.status(400).json({ success: false, message: 'Email already registered' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const result = await users.insertOne({ name, email, password: hashedPassword });
  res.status(201).json({ success: true, message: 'User registered successfully' });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const database = client.db("evgo");
  const users = database.collection("users");

  const user = await users.findOne({ email });
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  }
  res.status(200).json({ success: true, message: 'Login successful' });
});


app.post('/login/driver', async (req, res) => {
  const { email, password } = req.body;
  const database = client.db("evgo");
  const drivers = database.collection("drivers"); // Assuming you have a 'drivers' collection

  // Find driver by email
  const driver = await drivers.findOne({ email });

  // If driver is not found or password is incorrect
  if (!driver || !await bcrypt.compare(password, driver.password)) {
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  }

  // If login is successful
  res.status(200).json({ success: true, message: 'Driver login successful' });
});

app.post('/request-ev', async (req, res) => {
  const { userId, pickupLocation } = req.body;
  const database = client.db("evgo");
  const requests = database.collection("requests");

  const result = await requests.insertOne({ userId, pickupLocation, status: 'pending' });
  console.log(`New request inserted with ID: ${result.insertedId}`);

  // Notify all connected drivers about the new request
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'newRequest',
        id: result.insertedId.toString(),
        userId,
        pickupLocation
      }));
    }
  });

  res.status(201).json({ success: true, message: 'Request sent successfully' });
});
