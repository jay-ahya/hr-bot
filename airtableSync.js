// airtableSync.js
require('dotenv').config();
const Airtable = require('airtable');

// Configure Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const table = base(process.env.AIRTABLE_TABLE_NAME || 'Attendance Tracking');

/**
 * Sync a user's status to Airtable
 * @param {string} userId - Discord user ID
 * @param {string} userName - Discord user name
 * @param {string} status - 'online', 'idle', 'dnd', 'offline'
 * @returns {Promise} - Promise resolving to the updated/created record
 */
async function syncStatusToAirtable(userId, userName, status) {
  try {
    console.log(`Syncing ${userName} (${userId}) with status: ${status}`);
    
    // Find if user already exists in Airtable
    const records = await table.select({
      filterByFormula: `{User ID} = "${userId}"`,
    }).firstPage();
    
    const now = new Date().toISOString();
    
    if (records.length > 0) {
      // User exists, update their record
      const record = records[0];
      const currentCount = record.get(status) || 0;
      
      const fields = {
        [status]: currentCount + 1,
        'Last Updated': now
      };
      
      return await table.update(record.id, fields);
    } else {
      // User doesn't exist, create a new record
      const fields = {
        'User ID': userId,
        'User Name': userName,
        [status]: 1,
        'Last Updated': now
      };
      
      return await table.create(fields);
    }
  } catch (error) {
    console.error('Error syncing to Airtable:', error);
  }
}

/**
 * Increment BRB count for a user
 * @param {string} userId - Discord user ID
 * @param {string} userName - Discord user name
 * @returns {Promise} - Promise resolving to the updated/created record
 */
async function incrementBRB(userId, userName) {
  try {
    console.log(`Incrementing BRB count for ${userName} (${userId})`);
    
    // Find if user already exists in Airtable
    const records = await table.select({
      filterByFormula: `{User ID} = "${userId}"`,
    }).firstPage();
    
    const now = new Date().toISOString();
    
    if (records.length > 0) {
      // User exists, update their record
      const record = records[0];
      const currentBRBs = record.get('BRBs') || 0;
      
      return await table.update(record.id, {
        'BRBs': currentBRBs + 1,
        'Last Updated': now
      });
    } else {
      // User doesn't exist, create a new record
      return await table.create({
        'User ID': userId,
        'User Name': userName,
        'BRBs': 1,
        'Last Updated': now
      });
    }
  } catch (error) {
    console.error('Error incrementing BRB count:', error);
  }
}

module.exports = {
  syncStatusToAirtable,
  incrementBRB
};
