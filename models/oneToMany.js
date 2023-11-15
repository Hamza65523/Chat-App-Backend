const mongoose = require("mongoose");
const groupSchema = new mongoose.Schema({
    uid: {
        type: String,
        required: true,
        unique: true,
      },
    name: {
        type: String,
        required: true,
      },
      pic: String, 
  admins: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Reference to the User model (adjust based on your User model)
    },
  ],
  members: [
    {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
  ],
  messages: [
    {
    username:String,
    text:String,
    originalMessage:String,
    timestamp:Date,
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  publishedAt: {
    type: Date,
    default: Date.now,
  },
});

const GroupChat = mongoose.model("GroupChat", groupSchema);

module.exports = GroupChat;