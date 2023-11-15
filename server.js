const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
dotenv.config({ path: "./config.env" });
process.on("uncaughtException", (err) => {
  console.log(err);
  console.log("UNCAUGHT Exception! Shutting down ...");
  process.exit(1); // Exit Code 1 indicates that a container shut down, either because of an application failure.
});

const app = require("./app");

const http = require("http");
const server = http.createServer(app);

const { Server } = require("socket.io"); // Add this
const { promisify } = require("util");
const User = require("./models/user");
const FriendRequest = require("./models/friendRequest");
const OneToOneMessage = require("./models/OneToOneMessage");
const OneToMany = require("./models/oneToMany");
const AudioCall = require("./models/audioCall");
const VideoCall = require("./models/videoCall");

// Add this
// Create an io server and allow for CORS from http://localhost:3000 with GET and POST methods
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const DB = process.env.DATABASE
    
mongoose.connect(DB,{
    useNewUrlParser:true,
    useUnifiedTopology: true,

})
mongoose.connection.on('connected',()=>{
    console.log("conneted to mongo yeahh")
})
mongoose.connection.on('error',(err)=>{
    console.log("err connecting",err)
})
  
const port = process.env.PORT || 8000;

server.listen(port, () => {
  console.log(`App running on port ${port} ...`);
});

// Add this
// Listen for when the client connects via socket.io-client
io.on("connection", async (socket) => {
  console.log(JSON.stringify(socket.handshake.query));
  const user_id = socket.handshake.query["user_id"];

  console.log(`User connected ${socket.id}`);

  if (user_id != null && Boolean(user_id)) {
    try {
      User.findByIdAndUpdate(user_id, {
        socket_id: socket.id,
        status: "Online",
      });
    } catch (e) {
      console.log(e);
    }
  }

  // We can write our socket event listeners in here...
  socket.on("friend_request", async (data) => {
    const to = await User.findById(data.to).select("socket_id");
    const from = await User.findById(data.from).select("socket_id");

    // create a friend request
    await FriendRequest.create({
      sender: data.from,
      recipient: data.to,
    });
    // emit event request received to recipient
    io.to(to?.socket_id).emit("new_friend_request", {
      message: "New friend request received",
    });
    io.to(from?.socket_id).emit("request_sent", {
      message: "Request Sent successfully!",
    });
  });

  socket.on("accept_request", async (data) => {
    // accept friend request => add ref of each other in friends array
    console.log(data);
    const request_doc = await FriendRequest.findById(data.request_id);

    console.log(request_doc);

    const sender = await User.findById(request_doc.sender);
    const receiver = await User.findById(request_doc.recipient);

    sender.friends.push(request_doc.recipient);
    receiver.friends.push(request_doc.sender);

    await receiver.save({ new: true, validateModifiedOnly: true });
    await sender.save({ new: true, validateModifiedOnly: true });

    await FriendRequest.findByIdAndDelete(data.request_id);

    // delete this request doc
    // emit event to both of them

    // emit event request accepted to both
    io.to(sender?.socket_id).emit("request_accepted", {
      message: "Friend Request Accepted",
    });
    io.to(receiver?.socket_id).emit("request_accepted", {
      message: "Friend Request Accepted",
    });
  });

  socket.on("get_direct_conversations", async ({ user_id }, callback) => {
    const existing_conversations = await OneToOneMessage.find({
      participants: { $all: [user_id] },
    }).populate("participants", "firstName lastName avatar _id email status");

    // db.books.find({ authors: { $elemMatch: { name: "John Smith" } } })

    console.log(existing_conversations);

    callback(existing_conversations);
  });

  socket.on("start_conversation", async (data) => {
    // data: {to: from:}

    const { to, from } = data;

    // check if there is any existing conversation

    const existing_conversations = await OneToOneMessage.find({
      participants: { $size: 2, $all: [to, from] },
    }).populate("participants", "firstName lastName _id email status");

    console.log(existing_conversations[0], "Existing Conversation");

    // if no => create a new OneToOneMessage doc & emit event "start_chat" & send conversation details as payload
    if (existing_conversations.length === 0) {
      let new_chat = await OneToOneMessage.create({
        participants: [to, from],
      });

      new_chat = await OneToOneMessage.findById(new_chat).populate(
        "participants",
        "firstName lastName _id email status"
      );

      console.log(new_chat);

      socket.emit("start_chat", new_chat);
    }
    // if yes => just emit event "start_chat" & send conversation details as payload
    else {
      socket.emit("start_chat", existing_conversations[0]);
    }
  });

  socket.on("get_messages", async (data, callback) => {
    try {
      const { messages } = await OneToOneMessage.findById(
        data.conversation_id
      ).select("messages");
      callback(messages);
    } catch (error) {
      console.log(error);
    }
  });

  // Handle incoming text/link messages
  socket.on("text_message", async (data) => {
    console.log("Received message:", data);

    // data: {to, from, text}

    const { message, conversation_id, from, to, type } = data;

    const to_user = await User.findById(to);
    const from_user = await User.findById(from);

    // message => {to, from, type, created_at, text, file}

    const new_message = {
      to: to,
      from: from,
      type: type,
      created_at: Date.now(),
      text: message,
    };

    // fetch OneToOneMessage Doc & push a new message to existing conversation
    const chat = await OneToOneMessage.findById(conversation_id);
    console.log(chat,'chatlsdfjklsdf')
    chat.messages.push(new_message);
    console.log(chat,'1chatlsdfjklsdf')
    // save to db`
    await chat.save({ new: true, validateModifiedOnly: true });

    // emit incoming_message -> to user

    io.to(to_user?.socket_id).emit("new_message", {
      conversation_id,
      message: new_message,
    });

    // emit outgoing_message -> from user
    io.to(from_user?.socket_id).emit("new_message", {
      conversation_id,
      message: new_message,
    });
  });

  

  socket.on("file_message", async (data) => {
    console.log("Received message:", data);
  
    const { to, from, text, file } = data;
  
    // Get the file extension
    const fileExtension = path.extname(file.name);
  
    // Generate a unique filename
    const filename = `${Date.now()}_${Math.floor(
      Math.random() * 10000
    )}${fileExtension}`;
  
    // Save the file to a storage system (e.g., local file system)
    const filePath = path.join(__dirname, "uploads", filename); // Adjust the path as needed
    const fileStream = fs.createWriteStream(filePath);
  
    fileStream.on("error", (err) => {
      console.error("Error saving file:", err);
    });
  
    fileStream.on("finish", async () => {
      // Create a new message with file information
      const newFileMessage = {
        to,
        from,
        type: "File",
        created_at: Date.now(),
        text, // You may want to store additional information about the file
        file: filename,
      };
  
      try {
        // Find or create a conversation
        const existingConversation = await OneToOneMessage.findOneAndUpdate(
          {
            participants: { $size: 2, $all: [to, from] },
          },
          { participants: [to, from] },
          { upsert: true, new: true }
        );
  
        // Add the new message to the conversation
        existingConversation.messages.push(newFileMessage);
        await existingConversation.save();
  
        // Emit incoming_message to the recipient
        const recipientSocket = await User.findOne({ _id: to }).select("socket_id");
        io.to(recipientSocket?.socket_id).emit("new_message", {
          conversation_id: existingConversation._id,
          message: newFileMessage,
        });
  
        // Emit outgoing_message to the sender
        io.to(socket.id).emit("new_message", {
          conversation_id: existingConversation._id,
          message: newFileMessage,
        });
      } catch (error) {
        console.error("Error saving file message:", error);
      }
    });
    // Pipe the file stream to the storage system
    fileStream.write(file.data, "base64");
    fileStream.end();
  });
  

  // -------------- HANDLE GROUP MESSAGES SOCKET EVENTS ----------------- //
// Add user to group
socket.on('joinGroup',async (groupId,user_id) => {
// Update the admin UIDs
console.log(groupId,'groupId')
let user = await OneToMany.findOne({
  members: { $elemMatch: { _id: user_id } }
});

if(!user){
   OneToMany.findByIdAndUpdate(groupId,{
    $push:{members:user_id}
},{
    new:true
}).exec((err,result)=>{
    if(err){
      console.error(`Group with ID ${groupId} not found.`);
    }else{
      io.emit('userJoinedGroup', result);
      console.error(`user added in this group with ID ${groupId}.`);
    }
})
}else{
  console.error(`user already in group  ${user}.`);
  io.to(socket.id).emit('Unauthorized', { message: 'user already in group' });
  return;
}
});
socket.on("grouplist", async (group_id, callback) => {
  try {
    const groups  = await OneToMany.findById(
      {uid:group_id}
    );
    callback(groups);
  } catch (error) {
    io.to(socket.id).emit('Unauthorized', { message: 'You are not authorized.',error });
    return;
  }
});
// Edit group name or pic
socket.on('editGroup',async (groupId, newName, newPic) => {
  const group =await OneToMany.find({uid:groupId});
  if (group) {
    group.name = newName;
    group.pic = newPic;
    group.save();
    io.emit('groupEdited', group);
  }else{
    io.to(socket.id).emit('Unauthorized', { message: 'You are not authorized.' });
    return;
  }
});
// Assign admin role
socket.on('assignAdmin',async (groupId, userId) => {
  const group = await OneToMany.find({uid:groupId});
  if (group) {
    group.admins.push(userId);
    group.save();
    io.emit('adminAssigned', group);
  }else{
    io.to(socket.id).emit('Unauthorized', { message: 'You are not authorized.', });
    return;
  }
});
// Create a new group
socket.on('createGroup', async (groupName, groupPic, user_id, users_ids) => {
  const groupId = Math.random().toString(36).substring(2, 9);
  const group = {
    uid: groupId,
    name: groupName,
    pic: groupPic,
    admins: [user_id], // The creator is initially an admin
    members: users_ids,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: new Date()
  };

  const newGroup = new OneToMany(group);
  try {
    await newGroup.save();
    io.emit('groupCreated', group);
    res.json({ group, status: true });
  } catch (error) {
      io.to(socket.id).emit('Unauthorized', { message: 'You are not authorized.',error });
      return;
  }
});
// Remove a member from a group
socket.on('removeMember', async (groupId, adminId, memberId) => {
  try {
    const group = await OneToMany.findOne({ uid: groupId });

    // Check if the admin initiating the removal is indeed an admin of the group
    if (!group || !group.admins.includes(adminId)) {
      // Handle unauthorized removal
      io.to(socket.id).emit('removalUnauthorized', { message: 'You are not authorized to remove members.' });
      return;
    }

    // Remove the member from the group
    group.members = group.members.filter(member => member !== memberId);
    await group.save();

    // Notify the removed member
    io.to(socket.id).emit('memberRemoved', { groupId, memberId });

    // Notify all members of the group about the removal
    io.to(groupId).emit('memberRemoved', { groupId, memberId });
  } catch (error) {
    
      io.to(socket.id).emit('Unauthorized', { message: 'You are not authorized.',error });
      return;
    
  }
});
// Left user from group
socket.on('LeftUserFromGroup',async (groupId, userId) => {
  const group = await OneToMany.find({uid:groupId});
  if (group) {
    group.members = group.members.filter((member) => member !== userId);
    group.save();
    io.emit('userLeftFromGroup', group);
   
  }else{
    io.to(socket.id).emit('Unauthorized', { message: 'You are not authorized.' });
    return;
  }
});
// sendMessage
socket.on('sendMessage',async (groupId, text, originalMessage,user_id ) => {
  // Find the group by ID
  const group = await OneToMany.find({uid:groupId});
  if (group) {
    // Construct the message object
    const newMessage = {
      username: user_id,
      text: text,
      timestamp: Date.now(),
    };

    if (originalMessage) {
      // Include information about the original message if it's a replay
      newMessage.originalMessage = originalMessage;
    }

    // Add the message to the group's message history
    group.messages.push(newMessage);
    // Broadcast the message to all members of the group
  // console.log(group,'group',newMessage)
  // console.log(groups,'group')
  group.save()
  console.log(JSON.stringify(group, null, 2));
  console.log(newMessage,'newMessage')
  io.emit('receiveMessage',newMessage);
    // io.to(groupId).emit('receiveMessage', newMessage);
  }else{
    io.to(socket.id).emit('Unauthorized', { message: 'You are not authorized.' });
    return;
  }
});
socket.on("group_file_message", async (data) => {
  console.log("Received group message:", data);

  const { groupId, userId, text, file } = data;

  // Get the file extension
  const fileExtension = path.extname(file.name);

  // Generate a unique filename
  const filename = `${Date.now()}_${Math.floor(Math.random() * 10000)}${fileExtension}`;

  // Save the file to a storage system (e.g., local file system)
  const filePath = path.join(__dirname, "uploads", filename); // Adjust the path as needed
  const fileStream = fs.createWriteStream(filePath);

  fileStream.on("error", (err) => {
    console.error("Error saving file:", err);
  });

  fileStream.on("finish", async () => {
    // Create a new message with file information
    const newFileMessage = {
      userId,
      type: "File",
      created_at: Date.now(),
      text, // You may want to store additional information about the file
      file: filename,
    };

    try {
      // Find or create the group
      const group = await OneToMany.findOneAndUpdate(
        { uid: groupId },
        { $push: { messages: newFileMessage } },
        { upsert: true, new: true }
      );

      // Emit incoming_message to all group members
      io.to(groupId).emit("new_group_message", {
        groupId,
        message: newFileMessage,
      });
    } catch (error) {
      console.error("Error saving group file message:", error);
    }
  });

  // Pipe the file stream to the storage system
  fileStream.write(file.data, "base64");
  fileStream.end();
});
socket.on('sendFile', ({ groupId, fileUrl }) => {
  io.to(groupId).emit('fileSent', {
    fileUrl,
  });
});
  // -------------- HANDLE AUDIO CALL SOCKET EVENTS ----------------- //

  // handle start_audio_call event
  socket.on("start_audio_call", async (data) => {
    const { from, to, roomID } = data;

    const to_user = await User.findById(to);
    const from_user = await User.findById(from);

    console.log("to_user", to_user);

    // send notification to receiver of call
    io.to(to_user?.socket_id).emit("audio_call_notification", {
      from: from_user,
      roomID,
      streamID: from,
      userID: to,
      userName: to,
    });
  });

  // handle audio_call_not_picked
  socket.on("audio_call_not_picked", async (data) => {
    console.log(data);
    // find and update call record
    const { to, from } = data;

    const to_user = await User.findById(to);

    await AudioCall.findOneAndUpdate(
      {
        participants: { $size: 2, $all: [to, from] },
      },
      { verdict: "Missed", status: "Ended", endedAt: Date.now() }
    );

    // TODO => emit call_missed to receiver of call
    io.to(to_user?.socket_id).emit("audio_call_missed", {
      from,
      to,
    });
  });

  // handle audio_call_accepted
  socket.on("audio_call_accepted", async (data) => {
    const { to, from } = data;

    const from_user = await User.findById(from);

    // find and update call record
    await AudioCall.findOneAndUpdate(
      {
        participants: { $size: 2, $all: [to, from] },
      },
      { verdict: "Accepted" }
    );

    // TODO => emit call_accepted to sender of call
    io.to(from_user?.socket_id).emit("audio_call_accepted", {
      from,
      to,
    });
  });

  // handle audio_call_denied
  socket.on("audio_call_denied", async (data) => {
    // find and update call record
    const { to, from } = data;

    await AudioCall.findOneAndUpdate(
      {
        participants: { $size: 2, $all: [to, from] },
      },
      { verdict: "Denied", status: "Ended", endedAt: Date.now() }
    );

    const from_user = await User.findById(from);
    // TODO => emit call_denied to sender of call

    io.to(from_user?.socket_id).emit("audio_call_denied", {
      from,
      to,
    });
  });

  // handle user_is_busy_audio_call
  socket.on("user_is_busy_audio_call", async (data) => {
    const { to, from } = data;
    // find and update call record
    await AudioCall.findOneAndUpdate(
      {
        participants: { $size: 2, $all: [to, from] },
      },
      { verdict: "Busy", status: "Ended", endedAt: Date.now() }
    );

    const from_user = await User.findById(from);
    // TODO => emit on_another_audio_call to sender of call
    io.to(from_user?.socket_id).emit("on_another_audio_call", {
      from,
      to,
    });
  });

  // --------------------- HANDLE VIDEO CALL SOCKET EVENTS ---------------------- //

  // handle start_video_call event
  socket.on("start_video_call", async (data) => {
    const { from, to, roomID } = data;

    console.log(data);

    const to_user = await User.findById(to);
    const from_user = await User.findById(from);

    console.log("to_user", to_user);

    // send notification to receiver of call
    io.to(to_user?.socket_id).emit("video_call_notification", {
      from: from_user,
      roomID,
      streamID: from,
      userID: to,
      userName: to,
    });
  });

  // handle video_call_not_picked
  socket.on("video_call_not_picked", async (data) => {
    console.log(data);
    // find and update call record
    const { to, from } = data;

    const to_user = await User.findById(to);

    await VideoCall.findOneAndUpdate(
      {
        participants: { $size: 2, $all: [to, from] },
      },
      { verdict: "Missed", status: "Ended", endedAt: Date.now() }
    );

    // TODO => emit call_missed to receiver of call
    io.to(to_user?.socket_id).emit("video_call_missed", {
      from,
      to,
    });
  });

  // handle video_call_accepted
  socket.on("video_call_accepted", async (data) => {
    const { to, from } = data;

    const from_user = await User.findById(from);

    // find and update call record
    await VideoCall.findOneAndUpdate(
      {
        participants: { $size: 2, $all: [to, from] },
      },
      { verdict: "Accepted" }
    );

    // TODO => emit call_accepted to sender of call
    io.to(from_user?.socket_id).emit("video_call_accepted", {
      from,
      to,
    });
  });

  // handle video_call_denied
  socket.on("video_call_denied", async (data) => {
    // find and update call record
    const { to, from } = data;

    await VideoCall.findOneAndUpdate(
      {
        participants: { $size: 2, $all: [to, from] },
      },
      { verdict: "Denied", status: "Ended", endedAt: Date.now() }
    );

    const from_user = await User.findById(from);
    // TODO => emit call_denied to sender of call

    io.to(from_user?.socket_id).emit("video_call_denied", {
      from,
      to,
    });
  });

  // handle user_is_busy_video_call
  socket.on("user_is_busy_video_call", async (data) => {
    const { to, from } = data;
    // find and update call record
    await VideoCall.findOneAndUpdate(
      {
        participants: { $size: 2, $all: [to, from] },
      },
      { verdict: "Busy", status: "Ended", endedAt: Date.now() }
    );

    const from_user = await User.findById(from);
    // TODO => emit on_another_video_call to sender of call
    io.to(from_user?.socket_id).emit("on_another_video_call", {
      from,
      to,
    });
  });

  // -------------- HANDLE SOCKET DISCONNECTION ----------------- //

  socket.on("end", async (data) => {
    // Find user by ID and set status as offline

    if (data.user_id) {
      await User.findByIdAndUpdate(data.user_id, { status: "Offline" });
    }

    // broadcast to all conversation rooms of this user that this user is offline (disconnected)

    console.log("closing connection");
    socket.disconnect(0);
  });
});

process.on("unhandledRejection", (err) => {
  console.log(err);
  console.log("UNHANDLED REJECTION! Shutting down ...");
  server.close(() => {
    process.exit(1); //  Exit Code 1 indicates that a container shut down, either because of an application failure.
  });
});
