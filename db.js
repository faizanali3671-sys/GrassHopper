// Tiny JSON-file database. Zero native dependencies, so it installs everywhere.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');
fs.mkdirSync(DIR, { recursive: true });

const data = { secret: '', users: [], calls: [], voicemails: [] };

if (fs.existsSync(FILE)) {
  try {
    Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch (err) {
    console.error('Could not read data/db.json, starting fresh:', err.message);
  }
}
if (!data.secret) data.secret = crypto.randomBytes(32).toString('hex');

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE); // atomic swap so a crash never leaves half a file
}

save();
module.exports = { data, save, newId: () => crypto.randomUUID() };
