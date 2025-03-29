const axios = require("axios");

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;

const AIRTABLE_URL = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;

const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_TOKEN}`,
  "Content-Type": "application/json",
};

async function fetchAllRecords() {
  let allRecords = [];
  let offset = null;

  try {
    do {
      const response = await axios.get(AIRTABLE_URL, {
        headers: airtableHeaders,
        params: offset ? { offset } : {},
      });

      allRecords = [...allRecords, ...response.data.records];
      offset = response.data.offset;
    } while (offset);

    return allRecords;
  } catch (error) {
    console.error("Error fetching Airtable records:", error.message);
    return [];
  }
}

async function syncToAirtable(statusMap) {
  const existingRecords = await fetchAllRecords();

  const recordsByUserId = {};
  for (const record of existingRecords) {
    const userId = record.fields["User ID"];
    if (userId) {
      recordsByUserId[userId] = record;
    }
  }

  const updates = [];

  for (const [userId, data] of Object.entries(statusMap)) {
    const { name, status } = data;
    const airtableField =
      status === "idle"
        ? "Idle"
        : status === "dnd"
        ? "Do Not Disturb"
        : status === "offline"
        ? "Offline"
        : status === "online"
        ? "Online"
        : null;

    if (!airtableField) continue;

    const now = new Date().toISOString();

    if (recordsByUserId[userId]) {
      const record = recordsByUserId[userId];
      const currentValue = record.fields[airtableField] || 0;
      updates.push({
        id: record.id,
        fields: {
          [airtableField]: currentValue + 1,
          "Last Updated": now,
        },
      });
    } else {
      updates.push({
        fields: {
          "User ID": userId,
          "User Name": name,
          [airtableField]: 1,
          "Last Updated": now,
        },
      });
    }
  }

  // Airtable API supports batch updates up to 10 records at a time
  const chunked = [];
  for (let i = 0; i < updates.length; i += 10) {
    chunked.push(updates.slice(i, i + 10));
  }

  for (const batch of chunked) {
    try {
      const method = batch[0].id ? "patch" : "post";
      const url = batch[0].id ? `${AIRTABLE_URL}` : `${AIRTABLE_URL}`;
      await axios({
        method,
        url,
        headers: airtableHeaders,
        data: {
          records: batch,
        },
      });
    } catch (error) {
      console.error("Error syncing batch to Airtable:", error.message);
    }
  }
}

module.exports = { syncToAirtable };
