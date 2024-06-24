const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
  try {
    await mongoose.connect("mongodb+srv://sharpodsofficial:sharpodsyd1111@clustersharpods.9eimrkv.mongodb.net/?retryWrites=true&w=majority&appName=ClusterSharpods");
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.error('Error connecting to MongoDB', err);
    process.exit(1); 
  }
};

module.exports = connectDB;
