require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const cron = require("node-cron");
const { syncStatusToAirtable, incrementBRB } = require('./airtableSync');

// Utility: check if current date is the 3rd Saturday of the month
function isThirdSaturday(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  
  // Get the first day of the month
  const firstDay = new Date(year, month, 1);
  const firstDayOfWeek = firstDay.getDay(); // 0 = Sunday, 6 = Saturday
  
  // Calculate days to add to get to first Saturday
  // If first day is Sunday (0), first Saturday is 6 days later
  // If first day is Monday (1), first Saturday is 5 days later
  // If first day is Saturday (6), first Saturday is 0 days later
  const daysToFirstSaturday = (6 - firstDayOfWeek) % 7;
  
  // First Saturday date
  const firstSaturday = 1 + daysToFirstSaturday;
  
  // Third Saturday is 14 days (2 weeks) after first Saturday
  const thirdSaturday = firstSaturday + 14;
  
  // Check if current date is the third Saturday
  return date.getDate() === thirdSaturday;
}

// Utility: check if current time is within working hours
function isWorkingHour(date) {
  const day = date.getDay();    // 0 = Sunday, 6 = Saturday
  const hour = date.getHours(); // 0-23

  // Check if it's the 3rd Saturday of the month (team holiday)
  if (isThirdSaturday(date)) {
    console.log('🚫 Third Saturday of the month - team holiday, skipping status check');
    return false;
  }

  // Mon–Fri, 10:00–17:59
  if (day >= 1 && day <= 5 && hour >= 10 && hour < 18) {
    return true;
  }
  // Saturday (excluding 3rd Saturday), 10:00–12:59
  if (day === 6 && hour >= 10 && hour < 13) {
    return true;
  }
  return false;
}

// Random integer between min and max (inclusive)
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const app = express();
const port = process.env.PORT || 5001;

const guildId = process.env.GUILD_ID;
const channelId = process.env.CHANNEL_ID;
const discordToken = process.env.DISCORD_TOKEN;

// Comma-separated user IDs to ignore
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

let isClientReady = false;

// BRB detection and Airtable increment
const brbPatterns = [
  /\bbrb\b/i, /\bbreak\b/i, /\bback in/i, /\bstepping out\b/i,
  /\bstepping away\b/i, /\bgoing afk\b/i, /\btea break\b/i,
  /\bcoffee break\b/i, /\bbio break\b/i, /\breturning in\b/i,
  /\btaking 5\b/i, /\btaking five\b/i, /\btaking a moment\b/i
];

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const isBRB = brbPatterns.some(p => p.test(message.content));
  if (isBRB && !unavailableMemberIds.includes(message.author.id)) {
    const userName = message.author.globalName || message.author.username;
    console.log(`BRB detected from ${userName}`);
    await incrementBRB(message.author.id, userName);
  }
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  isClientReady = true;

  // Core status check function with guard
  const sendStatusMessage = async () => {
    const now = new Date();
    if (!isWorkingHour(now)) {
      console.log('⏭️ Outside working hours; skipping ping');
      return;
    }
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return console.error(`Guild not found: ${guildId}`);
      const channel = guild.channels.cache.get(channelId);
      if (!channel) return console.error(`Channel not found: ${channelId}`);

      console.log(`Checking statuses at ${now}`);
      const statuses = { online: [], idle: [], dnd: [], offline: [] };
      const members = await guild.members.fetch({ withPresences: true });
      const updates = [];

      members
        .filter(m => !m.user.bot && !unavailableMemberIds.includes(m.user.id))
        .forEach(member => {
          const userName = member.user.globalName || member.user.username;
          const status = member.presence ? member.presence.status : 'offline';
          statuses[status].push(userName);
          updates.push({ userId: member.user.id, userName, status });
        });

      const statusMsg = `
**Idle**: ${statuses.idle.length} - ${statuses.idle.join(', ')}
**Do Not Disturb**: ${statuses.dnd.length} - ${statuses.dnd.join(', ')}
**Offline**: ${statuses.offline.length} - ${statuses.offline.join(', ')}
      `;
      console.log(statusMsg);

      // Batch Airtable sync
      const BATCH = 5;
      for (let i = 0; i < updates.length; i += BATCH) {
        const batch = updates.slice(i, i + BATCH);
        await Promise.all(batch.map(u => syncStatusToAirtable(u.userId, u.userName, u.status)));
        if (i + BATCH < updates.length) await new Promise(r => setTimeout(r, 1000));
      }

      await channel.send(statusMsg);
    } catch (err) {
      console.error('Error in sendStatusMessage:', err);
    }
  };

  // Schedule Mon–Fri 10–17, skipping lunch transition windows
  for (let hour = 10; hour <= 17; hour++) {
    if (hour === 13) {
      const min = getRandomInt(1, 29);
      cron.schedule(`${min} ${hour} * * Mon-Fri`, sendStatusMessage, { timezone: 'Asia/Kolkata' });
    } else if (hour === 14) {
      const min = getRandomInt(31, 59);
      cron.schedule(`${min} ${hour} * * Mon-Fri`, sendStatusMessage, { timezone: 'Asia/Kolkata' });
    } else {
      const min = getRandomInt(1, 59);
      cron.schedule(`${min} ${hour} * * Mon-Fri`, sendStatusMessage, { timezone: 'Asia/Kolkata' });
    }
  }

  // Schedule Saturday 10–12 only (but will be skipped if it's 3rd Saturday)
  for (let hour = 10; hour <= 12; hour++) {
    const min = getRandomInt(1, 59);
    cron.schedule(`${min} ${hour} * * Saturday`, sendStatusMessage, { timezone: 'Asia/Kolkata' });
  }

  // Initial ping 10s after ready, but only if within working hours
  setTimeout(() => {
    const now = new Date();
    if (isWorkingHour(now)) sendStatusMessage();
    else console.log('Skipping startup ping; outside working hours');
  }, 10000);
});

client.on('error', err => console.error('Discord client error:', err));
client.login(discordToken).catch(err => console.error('Discord login failed:', err));

// Express status endpoint
app.get('/status', (req, res) => {
  res.json({ status: 'online', clientReady: isClientReady });
});
app.listen(port, () => console.log(`Server running on port ${port}`));
