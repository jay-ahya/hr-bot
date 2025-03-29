// server.js
require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const cron = require("node-cron");
const { syncToAirtable } = require("./airtableSync");

const app = express();
const port = 5001;

const guildId = process.env.GUILD_ID;
const channelId = process.env.CHANNEL_ID;
const discordToken = process.env.DISCORD_TOKEN;

const unavailableMemberIds = process.env.UNAVAILABLE_MEMBER_IDS
  ? process.env.UNAVAILABLE_MEMBER_IDS.split(",").map((id) => id.trim())
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

let isClientReady = false;

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  isClientReady = true;

  const sendStatusMessage = async () => {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return console.error(`Guild not found: ${guildId}`);

      const channel = guild.channels.cache.get(channelId);
      if (!channel) return console.error(`Channel not found: ${channelId}`);

      console.log(`Checking member statuses at ${new Date()}`);
      const statuses = {
        online: [],
        idle: [],
        dnd: [],
        offline: [],
      };

      const members = await guild.members.fetch({ withPresences: true });

      members
        .filter(
          (member) =>
            !member.user.bot && !unavailableMemberIds.includes(member.user.id)
        )
        .forEach((member) => {
          const presence = member.presence?.status || "offline";
          statuses[presence].push({
            id: member.user.id,
            name: member.user.globalName || member.user.username,
          });
        });

      const statusMap = {};
      ["idle", "dnd", "offline", "online"].forEach((status) => {
        statuses[status].forEach((user) => {
          statusMap[user.id] = {
            name: user.name,
            status: status,
          };
        });
      });

      await syncToAirtable(statusMap);
    } catch (err) {
      console.error("Error in sendStatusMessage:", err);
    }
  };

  const scheduleWithIST = (minute, hour, days) => {
    cron.schedule(`${minute} ${hour} * * ${days}`, sendStatusMessage, {
      timezone: "Asia/Kolkata",
    });
  };

  for (let hour = 10; hour <= 17; hour++) {
    if (hour === 13) {
      const m = getRandomInt(1, 29);
      scheduleWithIST(m, hour, "1-5");
    } else if (hour === 14) {
      const m = getRandomInt(31, 59);
      scheduleWithIST(m, hour, "1-5");
    } else {
      const m = getRandomInt(1, 59);
      scheduleWithIST(m, hour, "1-5");
    }
  }

  for (let hour = 10; hour <= 13; hour++) {
    const m = hour === 13 ? getRandomInt(1, 29) : getRandomInt(1, 59);
    scheduleWithIST(m, hour, "6");
  }

  setTimeout(sendStatusMessage, 10000);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();
  const brbTriggers = ["brb", "back in a bit", "taking a break", "brb 30", "brb 10"];
  const matched = brbTriggers.some((trigger) => content.includes(trigger));

  if (!matched) return;

  const userId = message.author.id;
  const userName = message.author.globalName || message.author.username;

  await syncToAirtable({
    [userId]: {
      name: userName,
      status: "brb",
    },
  });
});

client.on("error", (err) => console.error("Discord client error:", err));
client.login(discordToken).catch((err) => console.error("Login error:", err));

app.get("/status", (req, res) => {
  res.json({
    status: "online",
    clientReady: isClientReady,
    clientLoggedIn: client.isReady(),
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
