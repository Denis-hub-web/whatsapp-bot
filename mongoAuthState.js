const { proto } = require('@whiskeysockets/baileys');
const { BufferJSON } = require('@whiskeysockets/baileys');

/**
 * Custom MongoDB Auth State for Baileys
 * @param {import('mongodb').Collection} collection 
 */
async function useMongoDBAuthState(collection) {
    const writeData = async (data, id) => {
        try {
            const information = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
            await collection.replaceOne({ _id: id }, information, { upsert: true });
            if (id === 'creds') console.log(`[MongoDB] Successfully saved ${id}`);
        } catch (error) {
            console.error(`[MongoDB] Error writing ${id}:`, error);
        }
    };

    const readData = async (id) => {
        try {
            const data = await collection.findOne({ _id: id });
            if (data) {
                if (id === 'creds') console.log(`[MongoDB] Successfully restored ${id}`);
                return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
            }
        } catch (error) {
            console.error(`[MongoDB] Error reading ${id}:`, error);
        }
        return null;
    };

    const removeData = async (id) => {
        try {
            await collection.deleteOne({ _id: id });
            console.log(`[MongoDB] Removed ${id}`);
        } catch (error) {
            console.error(`[MongoDB] Error removing ${id}:`, error);
        }
    };

    const creds = await readData('creds') || require('@whiskeysockets/baileys').initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
        saveCreds: () => {
            return writeData(creds, 'creds');
        },
    };
}

module.exports = { useMongoDBAuthState };
