require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const cron = require("node-cron");
const { syncStatusToAirtable, incrementBRB } = require('./airtableSync');

const app = express();
const port = process.env.PORT || 5001;

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

// Set up BRB detection
const brbPatterns = [
  /\bbrb\b/i,
  /\bbreak\b/i,
  /\bback in/i,
  /\bstepping out\b/i,
  /\bstepping away\b/i,
  /\bgoing afk\b/i,
  /\btea break\b/i,
  /\bcoffee break\b/i,
  /\bbio break\b/i,
  /\breturning in/i,
  /\btaking 5\b/i,
  /\btaking five\b/i,
  /\btaking a moment\b/i
];

client.on('messageCreate', async (message) => {
  try {
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Check if the message contains BRB-like phrases
    const isBRBMessage = brbPatterns.some(pattern => pattern.test(message.content));
    
    // If it's a BRB message and user is not in the unavailable list
    if (isBRBMessage && !unavailableMemberIds.includes(message.author.id)) {
      const userName = message.author.globalName || message.author.username;
      console.log(`BRB detected from ${userName}: ${message.content}`);
      
      // Increment BRB count in Airtable
      await incrementBRB(message.author.id, userName);
    }
  } catch (error) {
    console.error('Error in message listener:', error);
  }
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  isClientReady = true;
  
  const sendStatusMessage = async () => {
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
      
      const members = await guild.members.fetch({ withPresences: true });
      
      // Track members to sync to Airtable
      const statusUpdates = [];
      
      members
        .filter(
          (member) =>
            !member.user.bot && !unavailableMemberIds.includes(member.user.id)
        )
        .forEach((member) => {
          const userName = member.user.globalName || member.user.username;
          const status = member.presence ? member.presence.status : 'offline';
          
          statuses[status].push(userName);
          
          // Queue Airtable sync
          statusUpdates.push({ 
            userId: member.user.id, 
            userName: userName, 
            status: status 
          });
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
      
      // Update Airtable in parallel but limit concurrency
      const BATCH_SIZE = 5; // Process 5 users at a time to avoid rate limits
      
      for (let i = 0; i < statusUpdates.length; i += BATCH_SIZE) {
        const batch = statusUpdates.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(({ userId, userName, status }) => 
            syncStatusToAirtable(userId, userName, status)
          )
        );
        
        // Small delay between batches to avoid hitting rate limits
        if (i + BATCH_SIZE < statusUpdates.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      try {
        await channel.send(statusMessage);
      } catch (error) {
        console.log("Error sending message:", error);
      }
    } catch (error) {
      console.error("Error in sendStatusMessage:", error);
    }
  };
  
  // Schedule for workdays (Monday-Friday) between 10 AM and 6 PM
  // Skip lunch break (1:30 PM - 2:30 PM)
  for (let hour = 10; hour <= 17; hour++) { // Changed from 18 to 17 to exclude checks after 6 PM
    // Skip the lunch hour (13 = 1 PM)
    if (hour === 13) {
      // For 1 PM, only schedule before 1:30 PM
      const randomMinute = getRandomInt(1, 29); // 1:01 to 1:29
      console.log(`Scheduling pre-lunch check for ${hour}:${randomMinute}`);
      
      cron.schedule(
        `${randomMinute} ${hour} * * Monday,Tuesday,Wednesday,Thursday,Friday`,
        sendStatusMessage,
        { timezone: "Asia/Kolkata" }
      );
    } 
    else if (hour === 14) {
      // For 2 PM, only schedule after 2:30 PM
      const randomMinute = getRandomInt(31, 59); // 2:31 to 2:59
      console.log(`Scheduling post-lunch check for ${hour}:${randomMinute}`);
      
      cron.schedule(
        `${randomMinute} ${hour} * * Monday,Tuesday,Wednesday,Thursday,Friday`,
        sendStatusMessage,
        { timezone: "Asia/Kolkata" }
      );
    }
    else {
      // Regular scheduling for other hours
      const randomMinute = getRandomInt(1, 59);
      console.log(`Scheduling regular check for ${hour}:${randomMinute}`);
      
      cron.schedule(
        `${randomMinute} ${hour} * * Monday,Tuesday,Wednesday,Thursday,Friday`,
        sendStatusMessage,
        { timezone: "Asia/Kolkata" }
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
        sendStatusMessage,
        { timezone: "Asia/Kolkata" }
      );
    } else {
      const randomMinute = getRandomInt(1, 59);
      console.log(`Scheduling Saturday check for ${hour}:${randomMinute}`);
      
      cron.schedule(
        `${randomMinute} ${hour} * * Saturday`,
        sendStatusMessage,
        { timezone: "Asia/Kolkata" }
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

// Middleware to check if Discord client is ready
function checkClientReady(req, res, next) {
  if (!isClientReady) {
    return res.status(503).json({ error: "Discord client not ready yet. Please try again later." });
  }
  next();
}

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
