const { proto } = require('@whiskeysockets/baileys');
const { BufferJSON } = require('@whiskeysockets/baileys');

/**
 * Custom MongoDB Auth State for Baileys
 * @param {import('mongodb').Collection} collection 
 */
async function useMongoDBAuthState(collection) {
    const writeData = (data, id) => {
        return collection.replaceOne(
            { _id: id },
            JSON.parse(JSON.stringify(data, BufferJSON.replacer)),
            { upsert: true }
        );
    };

    const readData = async (id) => {
        try {
            const data = await collection.findOne({ _id: id });
            if (data) {
                return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
            }
        } catch (error) {
            console.error(`Error reading ${id} from MongoDB:`, error);
        }
        return null;
    };

    const removeData = async (id) => {
        try {
            await collection.deleteOne({ _id: id });
        } catch (error) {
            console.error(`Error removing ${id} from MongoDB:`, error);
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
