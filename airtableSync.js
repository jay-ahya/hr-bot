require('dotenv').config();
const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const table = base(process.env.AIRTABLE_TABLE_NAME || 'Attendance Tracking');

async function syncStatusToAirtable(userId, userName, status) {
  try {
    console.log(`🔄 Syncing ${userName} (${userId}) → ${status}`);

    const records = await table.select({
      filterByFormula: `{User ID} = "${userId}"`,
      maxRecords: 1
    }).firstPage();

    const now = new Date().toISOString();

    if (records.length > 0) {
      const record = records[0];
      const currentCount = record.fields[status] || 0;

      await table.update(record.id, {
        [status]: currentCount + 1,
        'Last Updated': now
      });
      console.log(`✅ Updated ${userName}: +1 ${status}`);
    } else {
      await table.create({
        'User ID': userId,
        'User Name': userName,
        [status]: 1,
        'Last Updated': now
      });
      console.log(`🆕 Created new record for ${userName}`);
    }
  } catch (error) {
    console.error(`❌ Error syncing ${userName}:`, error);
  }
}

async function incrementBRB(userId, userName) {
  try {
    console.log(`🔁 Incrementing BRB for ${userName} (${userId})`);

    const records = await table.select({
      filterByFormula: `{User ID} = "${userId}"`,
      maxRecords: 1
    }).firstPage();

    const now = new Date().toISOString();

    if (records.length > 0) {
      const record = records[0];
      const currentBRBs = record.fields['BRBs'] || 0;

      await table.update(record.id, {
        'BRBs': currentBRBs + 1,
        'Last Updated': now
      });
      console.log(`✅ BRB updated for ${userName}`);
    } else {
      await table.create({
        'User ID': userId,
        'User Name': userName,
        'BRBs': 1,
        'Last Updated': now
      });
      console.log(`🆕 Created new BRB record for ${userName}`);
    }
  } catch (error) {
    console.error(`❌ Error incrementing BRB for ${userName}:`, error);
  }
}

module.exports = {
  syncStatusToAirtable,
  incrementBRB
};
