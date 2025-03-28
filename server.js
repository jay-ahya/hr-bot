require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");

const app = express();
const port = 5001;

const guildId = process.env.GUILD_ID;
const channelId = process.env.CHANNEL_ID;
const discordToken = process.env.DISCORD_TOKEN;

// Replace hardcoded array with environment variable
const unavailableMemberIds = process.env.UNAVAILABLE_MEMBER_IDS 
  ? process.env.UNAVAILABLE_MEMBER_IDS.split(',').map(id => id.trim())
  : [];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// Add a flag to track client ready state
let isClientReady = false;

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

console.log("Starting Discord bot...");

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  isClientReady = true;
  
  const sendStatusMessage = () => {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        console.error(`Guild not found: ${guildId}`);
        return;
      }
      
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        console.error(`Channel not found: ${channelId}`);
        return;
      }
      
      console.log(`Checking member statuses at ${new Date()}`);
      const statuses = {
        online: [],
        idle: [],
        dnd: [],
        offline: [],
      };
      
      guild.members.fetch({ withPresences: true }).then((members) => {
        members
          .filter(
            (member) =>
              !member.user.bot && !unavailableMemberIds.includes(member.user.id)
          )
          .forEach((member) => {
            if (member.presence) {
              statuses[member.presence.status].push(member.user.globalName || member.user.username);
            } else {
              statuses.offline.push(member.user.globalName || member.user.username);
            }
          });

        const statusMessage = `
         ${
           statuses.idle.length
             ? `\n**Idle**: ${statuses.idle.length} - ${statuses.idle.join(", ")}`
             : ""
         }${
          statuses.dnd.length
            ? `\n**Do not Disturb**: ${statuses.dnd.length} - ${statuses.dnd.join(
                ", "
              )}`
            : ""
        }${
          statuses.offline.length
            ? `\n**Offline**: ${
                statuses.offline.length
              } - ${statuses.offline.join(", ")}`
            : ""
        }
        `;
        console.log(statusMessage);
        try {
          channel.send(statusMessage);
        } catch (error) {
          console.log("Error sending message:", error);
        }
      }).catch(error => {
        console.error("Error fetching members:", error);
      });
    } catch (error) {
      console.error("Error in sendStatusMessage:", error);
    }
  };
  
 // Schedule for workdays (Monday-Friday) between 10 AM and 6 PM
// Skip lunch break (1:30 PM - 2:30 PM)
for (let hour = 10; hour <= 18; hour++) {
  // Skip the lunch hour (13 = 1 PM)
  if (hour === 13) {
    // For 1 PM, only schedule before 1:30 PM
    const randomMinute = getRandomInt(1, 29); // 1:01 to 1:29
    console.log(`Scheduling pre-lunch check for ${hour}:${randomMinute}`);
    
    cron.schedule(
      `${randomMinute} ${hour} * * Monday,Tuesday,Wednesday,Thursday,Friday`,
      sendStatusMessage
    );
  } 
  else if (hour === 14) {
    // For 2 PM, only schedule after 2:30 PM
    const randomMinute = getRandomInt(31, 59); // 2:31 to 2:59
    console.log(`Scheduling post-lunch check for ${hour}:${randomMinute}`);
    
    cron.schedule(
      `${randomMinute} ${hour} * * Monday,Tuesday,Wednesday,Thursday,Friday`,
      sendStatusMessage
    );
  }
  else {
    // Regular scheduling for other hours
    const randomMinute = getRandomInt(1, 59);
    console.log(`Scheduling regular check for ${hour}:${randomMinute}`);
    
    cron.schedule(
      `${randomMinute} ${hour} * * Monday,Tuesday,Wednesday,Thursday,Friday`,
      sendStatusMessage
    );
  }
}

// Schedule for Saturday between 10 AM and 1 PM only
for (let hour = 10; hour <= 13; hour++) {
  // For 1 PM on Saturday, only check before 1:30 PM
  if (hour === 13) {
    const randomMinute = getRandomInt(1, 29); // 1:01 to 1:29
    console.log(`Scheduling Saturday pre-end check for ${hour}:${randomMinute}`);
    
    cron.schedule(
      `${randomMinute} ${hour} * * Saturday`,
      sendStatusMessage
    );
  } else {
    const randomMinute = getRandomInt(1, 59);
    console.log(`Scheduling Saturday check for ${hour}:${randomMinute}`);
    
    cron.schedule(
      `${randomMinute} ${hour} * * Saturday`,
      sendStatusMessage
    );
  }
}
  
  // Initial status check when bot starts
  console.log("Scheduling initial status check in 10 seconds");
  setTimeout(sendStatusMessage, 10000); // Wait 10 seconds after ready before first check
});

// Log errors for better debugging
client.on('error', error => {
  console.error('Discord client error:', error);
});

// Login to Discord
client.login(discordToken).catch(error => {
  console.error("Failed to login to Discord:", error);
});

function messageFilter(message) {
  const startTimestamp = new Date("2025-02-01").getTime();
  const endTimeStamp = new Date("2025-03-01").getTime();
  return (
    message.author.id === "1254763273157476463" &&
    message.createdTimestamp >= startTimestamp &&
    message.createdTimestamp <= endTimeStamp
  );
}

// Middleware to check if Discord client is ready
function checkClientReady(req, res, next) {
  if (!isClientReady) {
    return res.status(503).json({ error: "Discord client not ready yet. Please try again later." });
  }
  next();
}

// Apply the middleware to relevant routes
app.use(['/brb', '/'], checkClientReady);

app.get("/", async (req, res) => {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: `Guild not found: ${guildId}` });
    }
    
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      return res.status(404).json({ error: `Channel not found: ${channelId}` });
    }
    
    let messages = await channel.messages.fetch({ limit: 100 });
    const attendanceMessages = Array.from(
      messages.filter((message) => message.author.id === "1254763273157476463"),
      ([key, value]) => value
    );
    
    do {
      const keys = messages.map((message) => parseInt(message.id));
      if (keys.length === 0) break; // Prevent infinite loop if no messages
      
      const lastKey = `${Math.min(...keys)}`;
      messages = await channel.messages.fetch({ limit: 100, before: lastKey });
      attendanceMessages.push(
        ...Array.from(
          messages.filter(
            (message) => message.author.id === "1254763273157476463"
          ),
          ([key, value]) => value
        )
      );
    } while (
      messages.filter((message) => message.author.id === "1254763273157476463")
        .size > 0
    );

    const attendanceCount = {};

    // fs.writeFileSync("messages.json", JSON.stringify(attendanceMessages));
    console.log(
      attendanceMessages.filter((message) => messageFilter(message)).length
    );

    for (const messageInstance of attendanceMessages.filter((message) =>
      messageFilter(message)
    )) {
      const message = messageInstance.content;
      const statuses = message.split("\n");
      const idleMessage = statuses.find((status) => status.includes("Idle"));
      const dndMessage = statuses.find((status) =>
        status.includes("Do not Disturb")
      );
      const offlineMessage = statuses.find((status) =>
        status.includes("Offline")
      );
      
      if (idleMessage) {
        const firstSplit = idleMessage.split(":");
        if (firstSplit.length > 1) {
          const parts = firstSplit[1].split(" - ");
          if (parts.length > 1) {
            const peopleList = parts[1];
            const people = peopleList.split(", ");
            for (const person of people) {
              if (!attendanceCount[person]) {
                attendanceCount[person] = {
                  idleCount: 1,
                };
              } else {
                if (!attendanceCount[person].idleCount) {
                  attendanceCount[person].idleCount = 1;
                } else {
                  attendanceCount[person].idleCount =
                    attendanceCount[person].idleCount + 1;
                }
              }
            }
          }
        }
      }
      
      if (dndMessage) {
        const firstSplit = dndMessage.split(":");
        if (firstSplit.length > 1) {
          const parts = firstSplit[1].split(" - ");
          if (parts.length > 1) {
            const peopleList = parts[1];
            const people = peopleList.split(", ");
            for (const person of people) {
              if (!attendanceCount[person]) {
                attendanceCount[person] = {
                  dndCount: 1,
                };
              } else {
                if (!attendanceCount[person].dndCount) {
                  attendanceCount[person].dndCount = 1;
                } else {
                  attendanceCount[person].dndCount =
                    attendanceCount[person].dndCount + 1;
                }
              }
            }
          }
        }
      }
      
      if (offlineMessage) {
        const firstSplit = offlineMessage.split(":");
        if (firstSplit.length > 1) {
          const parts = firstSplit[1].split(" - ");
          if (parts.length > 1) {
            const peopleList = parts[1];
            const people = peopleList.split(", ");
            for (const person of people) {
              if (!attendanceCount[person]) {
                attendanceCount[person] = {
                  offlineCount: 1,
                };
              } else {
                if (!attendanceCount[person].offlineCount) {
                  attendanceCount[person].offlineCount = 1;
                } else {
                  attendanceCount[person].offlineCount =
                    attendanceCount[person].offlineCount + 1;
                }
              }
            }
          }
        }
      }
    }
    fs.writeFileSync("attendance-feb.json", JSON.stringify(attendanceCount));
    res.json({
      done: "done",
    });
  } catch (error) {
    console.error("Error in / route:", error);
    res.status(500).json({ error: "An error occurred processing your request" });
  }
});

app.get("/brb", async (req, res) => {
  try {
    const startTimestamp = new Date("2024-08-21").getTime();
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      return res.status(404).json({ error: `Guild not found: ${guildId}` });
    }
    
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      return res.status(404).json({ error: `Channel not found: ${channelId}` });
    }
    
    let messages = await channel.messages.fetch({ limit: 100 });
    const brbMessages = Array.from(
      messages.filter((message) => {
        return (
          (message.content.toLowerCase().includes("brb") ||
            message.content.toLowerCase().includes("break") ||
            message.content.toLowerCase().includes("back")) &&
          !message.content.toLowerCase().includes("lunch")
        );
      }),
      ([key, value]) => value
    );
    
    do {
      const keys = messages.map((message) => parseInt(message.id));
      if (keys.length === 0) break; // Prevent infinite loop if no messages
      
      const lastKey = `${Math.min(...keys)}`;
      messages = await channel.messages.fetch({ limit: 100, before: lastKey });
      brbMessages.push(
        ...Array.from(
          messages.filter((message) => {
            return (
              (message.content.toLowerCase().includes("brb") ||
                message.content.toLowerCase().includes("break") ||
                message.content.toLowerCase().includes("back")) &&
              !message.content.toLowerCase().includes("lunch")
            );
          }),
          ([key, value]) => value
        )
      );
    } while (
      messages.every((message) => message.createdTimestamp > startTimestamp)
    );

    console.log(brbMessages.length > 0 ? brbMessages[0] : "No BRB messages found");

    const brbCount = {};
    for (const message of brbMessages) {
      const author = message.author.globalName || message.author.username;
      if (!brbCount[author]) {
        brbCount[author] = 1;
      } else {
        brbCount[author] = brbCount[author] + 1;
      }
    }

    fs.writeFileSync("brbmessages.json", JSON.stringify(brbMessages));
    console.log(brbMessages.length);
    res.json({ brbCount });
  } catch (error) {
    console.error("Error in /brb route:", error);
    res.status(500).json({ error: "An error occurred processing your request" });
  }
});

// Simple status endpoint
app.get("/status", (req, res) => {
  res.json({
    status: "online",
    clientReady: isClientReady,
    clientLoggedIn: client.isReady(),
    guildId: guildId,
    channelId: channelId,
    unavailableMemberCount: unavailableMemberIds.length,
    unavailableMembers: unavailableMemberIds
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
