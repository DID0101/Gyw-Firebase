const fs = require('fs');
const path = require('path');

const en = JSON.parse(fs.readFileSync(path.join(__dirname, '../i18n/locales/en.json'), 'utf8'));
const tr = JSON.parse(fs.readFileSync(path.join(__dirname, '../i18n/locales/tr.json'), 'utf8'));
const tk = JSON.parse(fs.readFileSync(path.join(__dirname, '../i18n/locales/tk.json'), 'utf8'));
const ru = JSON.parse(fs.readFileSync(path.join(__dirname, '../i18n/locales/ru.json'), 'utf8'));

const trAdd = {
  discover: { videoChatDescription: 'Rastgele biriyle video sohbet. Başlamak için dokunun.', pleaseSignIn: 'Discover kullanmak için giriş yapın', permissionError: 'İzin hatası', somethingWentWrong: 'Bir şeyler yanlış gitti', noPartnerFound: 'Eş bulunamadı', connecting: 'Bağlanıyor...', disconnected: 'Bağlantı kesildi', partnerLeft: 'Eş ayrıldı', stop: 'Durdur' },
  calls: { connecting: 'Bağlanıyor...', calling: 'Aranıyor...', incomingCall: 'Gelen arama', connected: 'Bağlandı', callEnded: 'Arama bitti', failedToInitiate: 'Arama başlatılamadı', incomingVideoCall: 'Gelen video araması', incomingAudioCall: 'Gelen sesli arama', missedCall: 'Kaçırılan arama', accept: 'Kabul', decline: 'Reddet', chooseCallTypeForLink: 'Bağlantı için arama türü seçin', createAudioCallLink: 'Sesli arama bağlantısı oluştur', createVideoCallLink: 'Video arama bağlantısı oluştur' },
  profile: { errorUpdatingProfile: 'Görsel yüklenemedi', uploading: 'Yükleniyor...' },
  auth: { countryCodeRequired: 'Lütfen ülke kodu ekleyin (örn. +1234567890)', sessionExpired: 'Oturum sona erdi. Lütfen baştan başlayın.', missingProfileData: 'Profil verisi eksik. Lütfen kayıt olmayı tekrar deneyin.', invalidPhoneFormat: 'Geçersiz telefon numarası formatı.', codeExpired: 'Kod süresi doldu. Lütfen yeni kod isteyin.' },
  messages: { failedToSend: 'Mesaj gönderilemedi', failedToDelete: 'Mesaj silinemedi', failedToEdit: 'Mesaj düzenlenemedi', permissionMicrophone: 'Lütfen mikrofon izni verin', permissionCameraRoll: 'Lütfen kamera rulosu izni verin', permissionCamera: 'Lütfen kamera izni verin', microphoneUnavailable: 'Mikrofon kullanılamıyor. Lütfen uygulamayı yeniden başlatın.', failedToSendAudio: 'Sesli mesaj gönderilemedi', failedToSendImage: 'Görsel gönderilemedi', failedToSendVideo: 'Video gönderilemedi', failedToSendPhoto: 'Fotoğraf gönderilemedi', failedToStartVideoCall: 'Video araması başlatılamadı', failedToStartAudioCall: 'Sesli arama başlatılamadı', newMessages: 'Yeni Mesajlar', replyingTo: 'Yanıtlanıyor', you: 'Siz', photo: 'Fotoğraf', video: 'Video', media: 'Medya', noMessagesYet: 'Henüz mesaj yok', callRejected: 'arama • Reddedildi', callDuration: 'arama •', call: 'Arama', youSentMedia: 'Bir medya gönderdiniz', mediaMessage: 'Medya mesajı', failedToRecord: 'Kayıt başlatılamadı', markAsRead: 'Okundu işaretle' },
  chats: { groupChat: 'Grup Sohbeti' },
  stories: { failedToLoad: 'Hikaye yüklenemedi', failedToLike: 'Hikaye beğenilemedi' },
  call: { sessionNotFound: 'Arama oturumu bulunamadı.', webrtcNotAvailable: 'WebRTC bu cihazda kullanılamıyor.', connectionFailed: 'Bağlantı Başarısız', unableToConnect: 'Bağlanılamıyor. Discover\'a dönülüyor.', mediaError: 'Medya Hatası', couldNotAccessCameraMic: 'Kamera/mikrofona erişilemedi.' }
};

const ruAdd = {
  discover: { videoChatDescription: 'Видеочат со случайным незнакомцем. Нажмите, чтобы начать.', pleaseSignIn: 'Войдите, чтобы использовать Discover', permissionError: 'Ошибка разрешения', somethingWentWrong: 'Что-то пошло не так', noPartnerFound: 'Партнёр не найден', connecting: 'Подключение...', disconnected: 'Отключено', partnerLeft: 'Партнёр вышел', stop: 'Стоп' },
  calls: { connecting: 'Подключение...', calling: 'Вызов...', incomingCall: 'Входящий звонок', connected: 'Подключено', callEnded: 'Звонок завершён', failedToInitiate: 'Не удалось начать звонок', incomingVideoCall: 'Входящий видеозвонок', incomingAudioCall: 'Входящий голосовой звонок', missedCall: 'Пропущенный звонок', accept: 'Принять', decline: 'Отклонить', chooseCallTypeForLink: 'Выберите тип звонка для ссылки', createAudioCallLink: 'Создать ссылку для голосового звонка', createVideoCallLink: 'Создать ссылку для видеозвонка' },
  profile: { errorUpdatingProfile: 'Не удалось загрузить изображение', uploading: 'Загрузка...' },
  auth: { countryCodeRequired: 'Укажите код страны (например, +1234567890)', sessionExpired: 'Сессия истекла. Начните заново.', missingProfileData: 'Данные профиля отсутствуют. Попробуйте снова зарегистрироваться.', invalidPhoneFormat: 'Неверный формат номера телефона.', codeExpired: 'Код истёк. Запросите новый код.' },
  messages: { failedToSend: 'Не удалось отправить сообщение', failedToDelete: 'Не удалось удалить сообщение', failedToEdit: 'Не удалось отредактировать сообщение', permissionMicrophone: 'Предоставьте доступ к микрофону', permissionCameraRoll: 'Предоставьте доступ к галерее', permissionCamera: 'Предоставьте доступ к камере', microphoneUnavailable: 'Микрофон недоступен. Перезапустите приложение.', failedToSendAudio: 'Не удалось отправить голосовое сообщение', failedToSendImage: 'Не удалось отправить изображение', failedToSendVideo: 'Не удалось отправить видео', failedToSendPhoto: 'Не удалось отправить фото', failedToStartVideoCall: 'Не удалось начать видеозвонок', failedToStartAudioCall: 'Не удалось начать голосовой звонок', newMessages: 'Новые сообщения', replyingTo: 'Ответ на', you: 'Вы', photo: 'Фото', video: 'Видео', media: 'Медиа', noMessagesYet: 'Пока нет сообщений', callRejected: 'звонок • Отклонён', callDuration: 'звонок •', call: 'Звонок', youSentMedia: 'Вы отправили медиа', mediaMessage: 'Медиа сообщение', failedToRecord: 'Не удалось начать запись', markAsRead: 'Отметить прочитанным' },
  chats: { groupChat: 'Групповой чат' },
  stories: { failedToLoad: 'Не удалось загрузить историю', failedToLike: 'Не удалось поставить лайк' },
  call: { sessionNotFound: 'Сессия звонка не найдена.', webrtcNotAvailable: 'WebRTC недоступен на этом устройстве.', connectionFailed: 'Ошибка подключения', unableToConnect: 'Не удалось подключиться. Возврат в Discover.', mediaError: 'Ошибка медиа', couldNotAccessCameraMic: 'Нет доступа к камере/микрофону.' }
};

const tkAdd = {
  discover: { videoChatDescription: 'Täze tanyş bilen wideo söhbet. Başlamak üçin basyň.', pleaseSignIn: 'Discover ulanymak üçin giriň', permissionError: 'Rugsat ýalňyşlygy', somethingWentWrong: 'Bir zat nädogry boldy', noPartnerFound: 'Ýoldaş tapylmady', connecting: 'Bağlanyşýar...', disconnected: 'Bağlanyşyk kesildi', partnerLeft: 'Ýoldaş çykdy', stop: 'Sakla' },
  calls: { connecting: 'Bağlanyşýar...', calling: 'Çagyrylýar...', incomingCall: 'Gelen çagyryş', connected: 'Bağlandy', callEnded: 'Çagyryş gutardy', failedToInitiate: 'Çagyryş başladylmady', incomingVideoCall: 'Gelen wideo çagyryş', incomingAudioCall: 'Gelen sesli çagyryş', missedCall: 'Görmezden gelinen çagyryş', accept: 'Kabul', decline: 'Red et', chooseCallTypeForLink: 'Baglanyşyk üçin çagyryş görnüşini saýlaň', createAudioCallLink: 'Sesli çagyryş baglanyşygy dörediň', createVideoCallLink: 'Wideo çagyryş baglanyşygy dörediň' },
  profile: { errorUpdatingProfile: 'Surat ýüklenmedi', uploading: 'Ýüklenýär...' },
  auth: { countryCodeRequired: 'Haýyş edýäris, ýurt kody goşuň (meselem, +1234567890)', sessionExpired: 'Sessiýa gutardy. Haýyş edýäris, täzeden başlaň.', missingProfileData: 'Profil maglumatlary ýok. Haýyş edýäris, täzeden hasaba almagy synaň.', invalidPhoneFormat: 'Nädogry telefon belgisi formaty.', codeExpired: 'Kod süresi gutardy. Haýyş edýäris, täze kod soraň.' },
  messages: { failedToSend: 'Habar iberilmedi', failedToDelete: 'Habar pozulmady', failedToEdit: 'Habar üýtgedilmedi', permissionMicrophone: 'Haýyş edýäris, mikrofon rugsatyny beriň', permissionCameraRoll: 'Haýyş edýäris, kamera rulosy rugsatyny beriň', permissionCamera: 'Haýyş edýäris, kamera rugsatyny beriň', microphoneUnavailable: 'Mikrofon elýeterli däl. Haýyş edýäris, programmany täzeden başladyň.', failedToSendAudio: 'Sesli habar iberilmedi', failedToSendImage: 'Surat iberilmedi', failedToSendVideo: 'Wideo iberilmedi', failedToSendPhoto: 'Foto iberilmedi', failedToStartVideoCall: 'Wideo çagyryş başladylmady', failedToStartAudioCall: 'Sesli çagyryş başladylmady', newMessages: 'Täze Habarlar', replyingTo: 'Jogap:', you: 'Siz', photo: 'Foto', video: 'Wideo', media: 'Media', noMessagesYet: 'Entek habar ýok', callRejected: 'çagyryş • Red edildi', callDuration: 'çagyryş •', call: 'Çagyryş', youSentMedia: 'Media iberdiňiz', mediaMessage: 'Media habar', failedToRecord: 'Ýazuw başladylmady', markAsRead: 'Okalan hökmünde belgile' },
  chats: { groupChat: 'Topar Söhbeti' },
  stories: { failedToLoad: 'Hikaya ýüklenmedi', failedToLike: 'Hikaya halaýan goýulmady' },
  call: { sessionNotFound: 'Çagyryş sessiýasy tapylmady.', webrtcNotAvailable: 'WebRTC bu enjamda elýeterli däl.', connectionFailed: 'Bağlanyşyk Ýalňyşlygy', unableToConnect: 'Bağlanyp bolmady. Discover-a dönýär.', mediaError: 'Media Ýalňyşlygy', couldNotAccessCameraMic: 'Kamera/mikrofona girip bolmady.' }
};

function mergeKeys(target, source) {
  for (const [section, keys] of Object.entries(source)) {
    if (!target[section]) target[section] = {};
    Object.assign(target[section], keys);
  }
}

mergeKeys(tr, trAdd);
mergeKeys(tk, tkAdd);
mergeKeys(ru, ruAdd);

fs.writeFileSync(path.join(__dirname, '../i18n/locales/tr.json'), JSON.stringify(tr, null, 2));
fs.writeFileSync(path.join(__dirname, '../i18n/locales/tk.json'), JSON.stringify(tk, null, 2));
fs.writeFileSync(path.join(__dirname, '../i18n/locales/ru.json'), JSON.stringify(ru, null, 2));

console.log('tr, tk, ru updated');
