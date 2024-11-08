const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
const mqtt = require("mqtt");
const http = require("http");
const socketIo = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(cors());
app.use(express.json());

const DB_PATH = path.join(__dirname, "db.json");

// MQTT client setup
const mqttClient = mqtt.connect(
  "mqtts://a9a4aebc.ala.us-east-1.emqxsl.com:8883",
  {
    clientId: "server_" + Math.random().toString(16).substr(2, 8),
    username: "diniot", // Replace with your MQTT username
    password: "125566aa", // Replace with your MQTT password
    rejectUnauthorized: false, // Only use this for testing. In production, use proper CA certificate verification
  },
);

mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker");
  mqttClient.subscribe("sensors/#");
});

mqttClient.on("message", async (topic, message) => {
  const data = JSON.parse(message.toString());
  // Process incoming sensor data
  if (topic === "sensors/gas") {
    if (data.value > 500) {
      // Assuming 500 is the threshold for dangerous gas levels
      io.emit("alert", { type: "gas", message: "High gas levels detected!" });
    }
    // Save gas sensor data
    const db = await readDB();
  } else if (topic === "sensors/light") {
    // Process light sensor data
    const db = await readDB();
    // Adjust lighting based on LDR input
  }
});

// Helper functions for reading and writing to the JSON file
async function readDB() {
  const data = await fs.readFile(DB_PATH, "utf8");
  return JSON.parse(data);
}

async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(
    token,
    "ca987984c0450e7b701a69e268b5cff670ff8590362ebef041dfbe0b9526a235",
    (err, user) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    },
  );
}

app.post("/register", async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const db = await readDB();
    const newUser = {
      id: Date.now().toString(),
      username: req.body.username,
      password: hashedPassword,
      role: "user",
    };
    db.users.push(newUser);
    await writeDB(db);
    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error creating user" });
  }
});

// User login
app.post("/login", async (req, res) => {
  const db = await readDB();
  const user = db.users.find((u) => u.username === req.body.username);
  if (user && (await bcrypt.compare(req.body.password, user.password))) {
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      "ca987984c0450e7b701a69e268b5cff670ff8590362ebef041dfbe0b9526a235",
      { expiresIn: "1h" },
    );
    res.json({ token });
  } else {
    res.status(400).json({ error: "Invalid credentials" });
  }
});

// New endpoints for door and light status
app.get("/door/status", authenticateToken, async (req, res) => {
  try {
    const db = await readDB();
    res.json({ status: db.doorStatus || "closed" });
  } catch (error) {
    res.status(500).json({ error: "Error fetching door status" });
  }
});

app.post("/door/toggle", authenticateToken, async (req, res) => {
  try {
    const db = await readDB();
    const newStatus = db.doorStatus === "open" ? "closed" : "open";
    db.doorStatus = newStatus;
    await writeDB(db);
    mqttClient.publish(
      "actuators/door",
      JSON.stringify({ command: newStatus }),
    );
    res.json({ status: newStatus });
  } catch (error) {
    res.status(500).json({ error: "Error toggling door" });
  }
});

app.get("/light/status", authenticateToken, async (req, res) => {
  try {
    const db = await readDB();
    res.json({ status: db.lightStatus || "off" });
  } catch (error) {
    res.status(500).json({ error: "Error fetching light status" });
  }
});

app.post("/light/toggle", authenticateToken, async (req, res) => {
  try {
    const db = await readDB();
    const newStatus = db.lightStatus === "on" ? "off" : "on";
    db.lightStatus = newStatus;
    await writeDB(db);
    mqttClient.publish(
      "actuators/light",
      JSON.stringify({ command: newStatus }),
    );
    res.json({ status: newStatus });
  } catch (error) {
    res.status(500).json({ error: "Error toggling light" });
  }
});

app.get("/sensors/gas", authenticateToken, async (req, res) => {
  try {
    const db = await readDB();
  } catch (error) {
    res.status(500).json({ error: "Error fetching gas sensor data" });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
