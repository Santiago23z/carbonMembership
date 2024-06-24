const TelegramBot = require('node-telegram-bot-api');
const WooCommerceAPI = require('woocommerce-api');
const mongoose = require('mongoose');
const UsedEmail = require('../models/UsedEmail');

const token = "7355686822:AAEXP1y5OWmQHSuaJyGlnKcNEtVumzI8e14";
const bot = new TelegramBot(token, { polling: true });

const WooCommerce = new WooCommerceAPI({
  url: 'https://www.sharpods.com/',
  consumerKey: "ck_f02ace259e6b96e2c395cdb46e4c709700279213",
  consumerSecret: "cs_f22ccf75d96e375ecec1fea0ef6b133ad8f95840",
  wpAPI: true,
  version: 'wc/v3',
  queryStringAuth: true
});

const channel = { id: '-1002007887417', name: 'Sharpods Club 💎' };

let emailSubscriptions = null; 
let emailSubscriptionsLastFetched = 0; 
let userSubscriptionStatus = {};
let userFetchingStatus = {};
let userLastActivity = {}; 

const getCarbonMembershipEmails = async () => {
  try {
    console.log('Fetching Carbon membership emails...');
    const now = Date.now();
    const cacheDuration = 24 * 60 * 60 * 1000; 

    if (emailSubscriptions && (now - emailSubscriptionsLastFetched) < cacheDuration) {
      console.log('Using cached email subscriptions');
      return emailSubscriptions;
    }

    let page = 1;
    let CarbonMembers = [];
    let totalPages = 1;

    const response = await WooCommerce.getAsync(`memberships/members?plan=carbon&page=${page}`);
    const responseBody = response.toJSON().body;
    const responseData = JSON.parse(responseBody);
    CarbonMembers = responseData;

    if (response.headers['x-wp-totalpages']) {
      totalPages = parseInt(response.headers['x-wp-totalpages']);
    }

    while (page < totalPages) {
      page++;
      const pageResponse = await WooCommerce.getAsync(`memberships/members?plan=carbon&page=${page}`);
      const pageBody = pageResponse.toJSON().body;
      const pageData = JSON.parse(pageBody);
      CarbonMembers = CarbonMembers.concat(pageData);
    }

    const CarbonEmails = await Promise.all(CarbonMembers.map(async (member) => {
      try {
        const customerResponse = await WooCommerce.getAsync(`customers/${member.customer_id}`);
        const customerResponseBody = customerResponse.toJSON().body;

        if (customerResponse.headers['content-type'].includes('application/json')) {
          const customerData = JSON.parse(customerResponseBody);
          return customerData.email.toLowerCase();
        } else {
          console.error(`Invalid response for customer ${member.customer_id}:`, customerResponseBody);
          return null;
        }
      } catch (error) {
        console.error(`Error al obtener detalles del cliente para el miembro ${member.id}:`, error);
        return null;
      }
    }));

    const validEmails = CarbonEmails.filter(email => email !== null);

    emailSubscriptions = validEmails;
    emailSubscriptionsLastFetched = now;

    console.log('Total de correos electrónicos con membresía "Carbon":', validEmails.length);
    console.log('Correos con membresía "Carbon":', JSON.stringify(validEmails, null, 2));

    return validEmails;
  } catch (error) {
    console.error('Error al obtener los correos de membresía Carbon:', error);
    return [];
  }
};

const verifyAndSaveEmail = async (chatId, email, bot) => {
  try {
    console.log(`Verifying email ${email} for chat ${chatId}`);
    if (await isEmailUsed(email)) {
      await bot.sendMessage(chatId, `El correo ${email} ya ha sido utilizado.`);
      return;
    }

    const CarbonEmails = await getCarbonMembershipEmails();
    const hasCarbonMembership = CarbonEmails.includes(email.toLowerCase());

    if (!hasCarbonMembership) {
      await bot.sendMessage(chatId, `No tienes una suscripción actualmente activa con la membresía "Carbon".`);
      return;
    }

    const link = await createInviteLink(channel.id);

    const buttonsLinks = {
      inline_keyboard: [[{ text: channel.name, url: link || 'https://example.com/invalid-link' }]]
    };

    const options = {
      reply_markup: JSON.stringify(buttonsLinks),
    };
    const message = `¡Ey parcerooo! Te doy una bienvenida a nuestro club premium: ¡Sharpods Club! Espero que juntos podamos alcanzar grandes victorias. ¡Mucha, mucha suerte, papi!`;
    await bot.sendMessage(chatId, message, options);

    await saveUsedEmail(email);
  } catch (error) {
    console.error(`Error verifying email for ${chatId}:`, error);
    await bot.sendMessage(chatId, 'Ocurrió un error al verificar el correo. Inténtalo de nuevo más tarde.');
  }
};

const saveUsedEmail = async (email) => {
  try {
    console.log(`Saving used email: ${email}`);
    const usedEmail = new UsedEmail({ email });
    await usedEmail.save();
  } catch (error) {
    console.error(`Error saving used email: ${error}`);
  }
};

const isEmailUsed = async (email) => {
  try {
    console.log(`Checking if email is used: ${email}`);
    const emailDoc = await UsedEmail.findOne({ email });
    return !!emailDoc;
  } catch (error) {
    console.error(`Error finding used email: ${error}`);
    return false;
  }
};

const createInviteLink = async (channelId) => {
  try {
    console.log(`Creating invite link for channel: ${channelId}`);
    const inviteLink = await bot.createChatInviteLink(channelId, {
      member_limit: 1, // Límite de un solo uso
    });
    return inviteLink.invite_link;
  } catch (error) {
    console.error('Error al crear el enlace de invitación:', error);
    return null;
  }
};

const WelcomeUser = () => {
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    if (msg.chat.type !== 'private') {
      console.log('Mensaje ignorado de grupo o canal');
      return;
    }

    if (!msg.text) {
      await bot.sendMessage(chatId, 'Por favor envía un correo electrónico válido.');
      return;
    }

    const text = msg.text.trim().toLowerCase();

    const now = Date.now();
    const lastActivity = userLastActivity[chatId] || 0;
    const inactivityTime = now - lastActivity;
    const maxInactivityTime = 2 * 60 * 1000; // 2 minutos en milisegundos

    if (inactivityTime > maxInactivityTime) {
      userSubscriptionStatus[chatId] = false;
    }

    userLastActivity[chatId] = now;

    if (userFetchingStatus[chatId]) {
      await bot.sendMessage(chatId, 'Por favor espera a que se obtengan las suscripciones activas.');
      return;
    }

    if (emailSubscriptions) {
      try {
        await verifyAndSaveEmail(chatId, text, bot);
      } catch (error) {
        console.error(`Error verifying email for ${chatId}:`, error);
      }
      return;
    }

    if (!userSubscriptionStatus[chatId]) {
      userFetchingStatus[chatId] = true;
      await bot.sendMessage(chatId, 'Obteniendo correos con membresía "Carbon", por favor espera. Podría tardar al menos un minuto.');

      try {
        const CarbonEmails = await getCarbonMembershipEmails();
        userFetchingStatus[chatId] = false;

        emailSubscriptions = CarbonEmails;
        userSubscriptionStatus[chatId] = true;
        await bot.sendMessage(chatId, 'Escribe el correo con el que compraste en Sharpods.');
      } catch (err) {
        userFetchingStatus[chatId] = false;
        await bot.sendMessage(chatId, 'Ocurrió un error al obtener los correos con membresía "Carbon". Vuelve a intentar escribiendome.');
      }
    } else {
      await bot.sendMessage(chatId, 'Ya se han obtenido los correos con membresía "Carbon". Escribe el correo con el que compraste en Sharpods.');
    }
  });
};

const UnbanChatMember = (userId) => {
  bot.unbanChatMember(channel.id, userId)
    .then(() => {
      console.log(`User unbanned from the channel ${channel.name}`);
    })
    .catch(err => console.log(`Error to unban user ${err}`));
};

const KickChatMember = (userId) => {
  bot.banChatMember(channel.id, userId)
    .then(() => {
      console.log(`User kicked from the channel ${channel.name}`);
    })
    .catch(err => console.log(`Error to kick user ${err}`));
};

module.exports = {
  WelcomeUser,
  UnbanChatMember,
  KickChatMember
};
