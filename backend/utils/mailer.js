const nodemailer = require('nodemailer');

// Shared, single configured transporter — Gmail SMTP via an App Password
// (never the real account password), credentials only ever in .env.
// Originally only defined inside authController.js for password-reset
// emails; pulled out here so organizationsController.js and
// staffController.js can send real emails too (temp passwords for newly
// created org_lead / org_staff accounts), without duplicating the setup.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

module.exports = { transporter };