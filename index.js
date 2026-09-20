require("dotenv").config();
require("./instrument"); // must come before any other module is required
const mongoose = require("mongoose");
const app = require("./app");
const { startDueSoonScheduler } = require('./utils/dueSoonScheduler');
const { ensureMvpTemplates } = require('./utils/ensureMvpTemplates');

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(async () => {
    console.log("Connected to MongoDB");
    try {
      const { created, upgraded } = await ensureMvpTemplates();
      if (created > 0) {
        console.log(`Edu: seeded ${created} MVP task template(s)`);
      }
      if (upgraded > 0) {
        console.log(`Edu: upgraded ${upgraded} MVP task template(s) to the corrected built-in definition`);
      }
    } catch (e) {
      console.warn('Edu: MVP template seed skipped:', e.message);
    }
    startDueSoonScheduler();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch(err => console.error("MongoDB connection error:", err));
