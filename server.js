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
    db.sensorData.push({
      type: "gas",
      value: data.value,
      timestamp: new Date().toISOString(),
    });
    await writeDB(db);
  } else if (topic === "sensors/light") {
    // Process light sensor data
    const db = await readDB();
    db.sensorData.push({
      type: "light",
      value: data.value,
      timestamp: new Date().toISOString(),
    });
    await writeDB(db);
    // Adjust lighting based on LDR input
    if (data.value < 100) {
      // Assuming 100 is the threshold for low light
      mqttClient.publish("actuators/light", JSON.stringify({ state: "on" }));
    } else {
      mqttClient.publish("actuators/light", JSON.stringify({ state: "off" }));
    }
  }
});

// Helper function to read the database
async function readDB() {
  try {
    const data = await fs.readFile(DB_PATH, "utf8");
    return JSON.parse(data);
  } catch (error) {
    // If the file doesn't exist, return an empty database structure
    return { users: [], rfidTags: [], sensorData: [] };
  }
}

// Helper function to write to the database
async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// JWT Authentication middleware
const authenticateJWT = (req, res, next) => {
  const token = req.header("Authorization");
  if (!token) return res.status(401).json({ error: "Access denied" });

  jwt.verify(
    token,
    "ca987984c0450e7b701a69e268b5cff670ff8590362ebef041dfbe0b9526a235",
    (err, user) => {
      if (err) return res.status(403).json({ error: "Invalid token" });
      req.user = user;
      next();
    },
  );
};

// API Routes

// User registration
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

// Door access control
app.post("/door/access", authenticateJWT, async (req, res) => {
  const { tagId } = req.body;
  const db = await readDB();
  const tag = db.rfidTags.find((t) => t.tagId === tagId);
  if (tag) {
    mqttClient.publish("actuators/door", JSON.stringify({ state: "unlock" }));
    res.json({ message: "Access granted" });
  } else {
    res.status(403).json({ error: "Access denied" });
  }
});

// Get sensor data
app.get("/sensors/:type", authenticateJWT, async (req, res) => {
  const db = await readDB();
  const data = db.sensorData
    .filter((d) => d.type === req.params.type)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);
  res.json(data);
});

// Admin: Add RFID tag
app.post("/admin/rfid", authenticateJWT, async (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin access required" });

  const { tagId, userId } = req.body;
  const db = await readDB();
  db.rfidTags.push({ tagId, userId });
  await writeDB(db);
  res.status(201).json({ message: "RFID tag added successfully" });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
