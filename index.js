require('dotenv').config();
const express = require('express');

const app = express();
const connectDB = require('./db');
const kickUserRoute = require('./routes/routerKickChatMember');
const unbanUserRoute = require('./routes/routerUnbanMember');
const {WelcomeUser} = require("./controllers/functions.handler")

const cors = require('cors');
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;
connectDB();
WelcomeUser();


app.use('/KickUser', kickUserRoute);
app.use('/UnbanUser', unbanUserRoute);
// app.use("/welcome", welcomee)


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});