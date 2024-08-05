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

const channel = { id: '-1002151912581', name: 'Club Sharpods 💎' };

let userState = {}; // Almacenar estado de cada usuario

const getCarbonMembershipEmails = async (chatId) => {
  try {
    console.log(`Fetching Carbon membership emails for chat ${chatId}`);
    const now = Date.now();
    const cacheDuration = 24 * 60 * 60 * 1000;

    if (userState[chatId] && userState[chatId].emailSubscriptions && (now - userState[chatId].emailSubscriptionsLastFetched) < cacheDuration) {
      console.log(`Using cached email subscriptions for chat ${chatId}`);
      return userState[chatId].emailSubscriptions;
    }

    let page = 1;
    let CarbonMembers = [];
    let totalPages = 1;

    do {
      const response = await WooCommerce.getAsync(`memberships/members?plan=carbon&page=${page}`);
      const responseBody = response.toJSON().body;
      const responseData = JSON.parse(responseBody);

      if (Array.isArray(responseData) && responseData.length > 0) {
        CarbonMembers = CarbonMembers.concat(responseData);
      } else {
        console.error(`Unexpected response data format: ${responseBody}`);
        break;
      }

      if (response.headers['x-wp-totalpages']) {
        totalPages = parseInt(response.headers['x-wp-totalpages']);
      }

      page++;
    } while (page <= totalPages);

    const CarbonEmails = await Promise.all(CarbonMembers.map(async (member) => {
      try {
        const customerResponse = await WooCommerce.getAsync(`customers/${member.customer_id}`);
        const customerResponseBody = customerResponse.toJSON().body;

        if (customerResponse.headers['content-type'].includes('application/json')) {
          const customerData = JSON.parse(customerResponseBody);
          return {
            email: customerData.email.toLowerCase(),
            status: member.status
          };
        } else {
          console.error(`Invalid response for customer ${member.customer_id}: ${customerResponseBody}`);
          return null;
        }
      } catch (error) {
        console.error(`Error al obtener detalles del cliente para el miembro ${member.id}:`, error);
        return null;
      }
    }));

    const validEmails = CarbonEmails.filter(entry => entry !== null);

    if (!userState[chatId]) {
      userState[chatId] = {};
    }

    userState[chatId].emailSubscriptions = validEmails;
    userState[chatId].emailSubscriptionsLastFetched = now;

    console.log(`Total de correos electrónicos con membresía "Carbon" para chat ${chatId}: ${validEmails.length}`);
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
      const options = {
        reply_markup: JSON.stringify({
          inline_keyboard: [
            [{ text: 'Revocar Acceso', callback_data: `revoke_${email}` }]
          ]
        })
      };
      await bot.sendMessage(chatId, '¿Deseas revocar el acceso?', options);
      return;
    }

    const CarbonEmails = await getCarbonMembershipEmails(chatId);
    console.log(`Fetched Carbon emails: ${JSON.stringify(CarbonEmails, null, 2)}`);
    const emailEntry = CarbonEmails.find(entry => entry.email === email.toLowerCase());

    console.log(`Email entry found: ${JSON.stringify(emailEntry, null, 2)}`);

    if (!emailEntry) {
      await bot.sendMessage(chatId, `No tienes una suscripción actualmente activa con la membresía "Carbon".`);
      userState[chatId].awaitingEmail = false; // Reset awaiting email state
      return;
    }

    const link = await createInviteLink(chatId, email);

    const buttonsLinks = {
      inline_keyboard: [[{ text: channel.name, url: link || 'https://example.com/invalid-link' }]]
    };

    const options = {
      reply_markup: JSON.stringify(buttonsLinks),
    };
    const message = `¡Ey parcerooo! Te doy una bienvenida a nuestro club premium: ¡Sharpods Club! Espero que juntos podamos alcanzar grandes victorias. ¡Mucha, mucha suerte, papi!`;
    await bot.sendMessage(chatId, message, options);

    await bot.sendMessage(chatId, `El estado de tu membresía es: ${emailEntry.status}`);

    await saveUsedEmail(email);
    userState[chatId].currentEmail = email; // Guarda el email en el estado del usuario para asociarlo con el userId cuando se una al canal
    userState[chatId].awaitingEmail = false; // Reset awaiting email state
  } catch (error) {
    console.error(`Error verifying email for ${chatId}:`, error);
    await bot.sendMessage(chatId, 'Ocurrió un error al verificar el correo. Inténtalo de nuevo más tarde.');
    userState[chatId].awaitingEmail = false; // Reset awaiting email state in case of error
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

// Función para crear un enlace de invitación y almacenar el estado
const createInviteLink = async (chatId, email) => {
  try {
    console.log(`Creating invite link for channel: ${channel.id}`);
    const inviteLink = await bot.createChatInviteLink(channel.id, {
      member_limit: 1, // Límite de un solo uso
    });

    // Guarda el estado del enlace generado
    userState[chatId] = {
      ...userState[chatId],
      inviteLink: inviteLink.invite_link,
      inviteTimestamp: Date.now(),
      currentEmail: email
    };

    return inviteLink.invite_link;
  } catch (error) {
    console.error('Error al crear el enlace de invitación:', error);
    return null;
  }
};

// Función para manejar el evento chat_member
const handleChatMember = (bot) => {
  bot.on('chat_member', async (msg) => {
    const chatId = msg.chat.id;
    const newUser = msg.new_chat_member;

    if (newUser && newUser.status === 'member') {
      const userId = newUser.user.id;
      const email = userState[chatId]?.currentEmail;

      if (email) {
        console.log(`Nuevo miembro con userId: ${userId} y email: ${email}`);
        await saveUserId(email, userId);
        delete userState[chatId].currentEmail; // Limpia el estado del usuario
      }
    }
  });
};

const saveUserId = async (email, userId) => {
  try {
    console.log(`Guardando userId ${userId} para el email ${email}`);
    await UsedEmail.updateOne({ email }, { userId: userId });
  } catch (error) {
    console.error(`Error al guardar userId para el email ${email}:`, error);
  }
};

const revokeAccess = async (chatId, email) => {
  try {
    console.log(`Revoking access for email: ${email}`);
    const usedEmail = await UsedEmail.findOne({ email });
    if (usedEmail) {
      const userId = usedEmail.userId;
      if (userId) {
        // Expulsar al usuario del canal de Telegram
        await bot.banChatMember(channel.id, userId);
        console.log(`Usuario ${userId} expulsado del canal.`);
      }

      // Eliminar el correo de la base de datos
      const result = await UsedEmail.deleteOne({ email });
      if (result.deletedCount > 0) {
        console.log(`Email ${email} eliminado de la base de datos.`);
        await bot.sendMessage(chatId, `Acceso revocado para ${email}.`);
      } else {
        console.log(`Email ${email} no encontrado en la base de datos.`);
        await bot.sendMessage(chatId, `No se encontró el correo ${email} en la base de datos.`);
      }
    } else {
      console.log(`Email ${email} no encontrado en la base de datos.`);
      await bot.sendMessage(chatId, `No se encontró el correo ${email} en la base de datos.`);
    }
  } catch (error) {
    console.error(`Error revoking access for email ${email}:`, error);
    await bot.sendMessage(chatId, `Ocurrió un error al revocar el acceso para ${email}.`);
  }
};

// Manejador de mensajes del bot
const WelcomeUser = () => {
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    if (!userState[chatId]) {
      userState[chatId] = {
        fetchingStatus: false,
        lastActivity: 0,
        awaitingEmail: false
      };
    }

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
    const lastActivity = userState[chatId].lastActivity;
    const inactivityTime = now - lastActivity;
    const maxInactivityTime = 2 * 60 * 1000; // 2 minutos en milisegundos

    userState[chatId].lastActivity = now;

    if (userState[chatId].fetchingStatus) {
      await bot.sendMessage(chatId, 'Por favor espera a que se obtengan las suscripciones activas.');
      return;
    }

    if (userState[chatId].emailSubscriptions && (inactivityTime < maxInactivityTime)) {
      if (!userState[chatId].awaitingEmail) {
        userState[chatId].awaitingEmail = true;
        await bot.sendMessage(chatId, 'Escribe el correo con el que compraste en Sharpods.');
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) {
        await bot.sendMessage(chatId, 'Solo puedo recibir correos electrónicos. Por favor, envía un correo electrónico válido.');
        return;
      }

      try {
        await verifyAndSaveEmail(chatId, text, bot);
        userState[chatId].awaitingEmail = false;
      } catch (error) {
        console.error(`Error verifying email for ${chatId}:`, error);
      }
      return;
    }

    if (!userState[chatId].fetchingStatus) {
      userState[chatId].fetchingStatus = true;
      await bot.sendMessage(chatId, 'Obteniendo correos con membresía "Carbon", por favor espera. Podría tardar al menos un minuto.');

      try {
        const CarbonEmails = await getCarbonMembershipEmails(chatId);
        userState[chatId].fetchingStatus = false;

        userState[chatId].emailSubscriptions = CarbonEmails;
        userState[chatId].awaitingEmail = true;
        await bot.sendMessage(chatId, 'Escribe el correo con el que compraste en Sharpods.');
      } catch (err) {
        userState[chatId].fetchingStatus = false;
        userState[chatId].awaitingEmail = false;
        await bot.sendMessage(chatId, 'Ocurrió un error al obtener los correos con membresía "Carbon". Vuelve a intentar escribiéndome.');
      }
    } else {
      await bot.sendMessage(chatId, 'Ya se han obtenido los correos con membresía "Carbon". Escribe el correo con el que compraste en Sharpods.');
    }
  });
};

// Manejador de botones
const handleCallbackQuery = async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('revoke_')) {
    const email = data.replace('revoke_', '');
    await revokeAccess(chatId, email);
  }
};

bot.on('callback_query', handleCallbackQuery);

// Funciones para desbanear y expulsar usuarios
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

// Inicializar los manejadores
WelcomeUser();
handleChatMember(bot);

module.exports = {
  WelcomeUser,
  UnbanChatMember,
  KickChatMember
};
