import type { PartialTranslation } from './en';

/**
 * Sinhala — DRAFT. Must be reviewed by a native speaker before launch
 * (see docs/localization.md). Missing keys fall back to English.
 */
export const si: PartialTranslation = {
  common: {
    loading: 'පූරණය වෙමින්…',
    retry: 'නැවත උත්සාහ කරන්න',
    continue: 'ඉදිරියට',
    signOut: 'වරන්න',
    optional: 'අත්‍යවශ්‍ය නොවේ',
    skipToContent: 'ප්‍රධාන අන්තර්ගතයට යන්න',
    showPassword: 'මුරපදය පෙන්වන්න',
    hidePassword: 'මුරපදය සඟවන්න',
  },
  language: { label: 'භාෂාව' },
  auth: {
    login: {
      title: 'පිවිසෙන්න',
      subtitle: 'නැවත සාදරයෙන් පිළිගනිමු. ඔබගේ ව්‍යාපාරයට පිවිසෙන්න.',
      email: 'විද්‍යුත් තැපෑල',
      password: 'මුරපදය',
      submit: 'පිවිසෙන්න',
      forgot: 'මුරපදය අමතකද?',
      noAccount: 'Ensoftic POS වෙත අලුත්ද?',
      register: 'ව්‍යාපාර ගිණුමක් සාදන්න',
      chooseBusiness: 'ව්‍යාපාරයක් තෝරන්න',
      sessionEnded: 'ඔබගේ සැසිය අවසන් විය. කරුණාකර නැවත පිවිසෙන්න.',
      passwordReset: 'මුරපදය යාවත්කාලීන විය. නව මුරපදයෙන් පිවිසෙන්න.',
    },
    register: {
      title: 'ඔබගේ ව්‍යාපාර ගිණුම සාදන්න',
      businessName: 'ව්‍යාපාරයේ නම',
      ownerFullName: 'ඔබගේ සම්පූර්ණ නම',
      email: 'විද්‍යුත් තැපෑල',
      password: 'මුරපදය',
      passwordHint: 'අවම වශයෙන් අකුරු 10ක්.',
      submit: 'ගිණුම සාදන්න',
      haveAccount: 'දැනටමත් ගිණුමක් තිබේද?',
      signIn: 'පිවිසෙන්න',
    },
    forgot: {
      title: 'මුරපදය යළි සකසන්න',
      submit: 'යළි සැකසීමේ සබැඳිය යවන්න',
      sentTitle: 'ඔබගේ විද්‍යුත් තැපෑල පරීක්ෂා කරන්න',
      backToLogin: 'පිවිසීමට ආපසු',
    },
    reset: {
      title: 'නව මුරපදයක් තෝරන්න',
      password: 'නව මුරපදය',
      confirm: 'නව මුරපදය තහවුරු කරන්න',
      mismatch: 'මුරපද නොගැළපේ',
      submit: 'මුරපදය යාවත්කාලීන කරන්න',
      requestNew: 'නව සබැඳියක් ඉල්ලන්න',
    },
  },
  onboarding: {
    title: 'ඔබගේ ව්‍යාපාරය සකසන්න',
    businessName: 'ව්‍යාපාරයේ නම',
    businessType: 'ව්‍යාපාර වර්ගය',
    contactPhone: 'දුරකථන අංකය',
    submit: 'සැකසීම අවසන් කරන්න',
  },
  businessTypes: {
    COSMETICS: { label: 'රූපලාවණ්‍ය' },
    TEXTILE: { label: 'රෙදිපිළි සහ ඇඳුම්' },
    GENERAL_RETAIL: { label: 'සාමාන්‍ය සිල්ලර' },
  },
  roles: {
    OWNER: 'හිමිකරු',
    MANAGER: 'කළමනාකරු',
    CASHIER: 'මුදල් අයකැමි',
    INVENTORY_STAFF: 'තොග කාර්ය මණ්ඩලය',
  },
  nav: {
    dashboard: 'උපකරණ පුවරුව',
    auditLog: 'ක්‍රියාකාරකම් සටහන',
    settings: 'සැකසුම්',
    sell: 'විකුණන්න',
    sales: 'විකුණුම්',
    customers: 'පාරිභෝගිකයින්',
    reports: 'වාර්තා',
  },
  paymentMethods: {
    CASH: 'මුදල්',
    CARD: 'කාඩ්පත',
    BANK_TRANSFER: 'බැංකු මාරුව',
    OTHER: 'වෙනත්',
    ACCOUNT: 'ණයට',
  },
  pos: {
    title: 'විකුණන්න',
    subtotal: 'උප එකතුව',
    discount: 'වට්ටම',
    tax: 'බද්ද',
    total: 'මුළු මුදල',
    pay: 'ගෙවන්න',
    change: 'ඉතිරි මුදල',
    complete: 'විකිණීම සම්පූර්ණ කරන්න',
    newSale: 'නව විකිණීමක්',
    print: 'රිසිට්පත මුද්‍රණය කරන්න',
  },
  approval: {
    title: 'කළමනාකරු අනුමැතිය',
    approve: 'අනුමත කරන්න',
    cancel: 'අවලංගු කරන්න',
  },
  validation: {
    required: 'මෙම ක්ෂේත්‍රය අවශ්‍යයි',
    email: { invalid: 'වලංගු විද්‍යුත් තැපැල් ලිපිනයක් ඇතුළත් කරන්න' },
    password: { too_short: 'අවම වශයෙන් අකුරු 10ක් භාවිතා කරන්න' },
  },
  errors: {
    generic: 'යමක් වැරදී ඇත. කරුණාකර නැවත උත්සාහ කරන්න.',
    INVALID_CREDENTIALS: 'විද්‍යුත් තැපෑල හෝ මුරපදය වැරදියි.',
    NETWORK_ERROR: 'සේවාදායකයට සම්බන්ධ විය නොහැක. ඔබගේ සම්බන්ධතාවය පරීක්ෂා කරන්න.',
    DEVICE_REVOKED:
      'මෙම උපාංගය ව්‍යාපාරය විසින් අවහිර කර ඇත. නැවත ඉඩ දීමට අයිතිකරු හෝ කළමනාකරු අමතන්න.',
    BRANCH_NOT_ALLOWED: 'ඔබට මෙම ශාඛාවට ප්‍රවේශය නැත.',
    SUBSCRIPTION_INACTIVE: 'සැලැස්මක් ගෙවන තුරු මෙම ගිණුම කියවීමට පමණි.',
    PLAN_LIMIT_REACHED:
      'ඔබගේ සැලැස්මට මේවා තවත් ඇතුළත් නොවේ. සැලැස්ම සහ බිල්පත් වෙතින් උසස් කරන්න.',
    INVITATION_INVALID:
      'මෙම ආරාධනා සබැඳිය වලංගු නැත, භාවිත කර හෝ කල් ඉකුත් වී ඇත. නව එකක් ඉල්ලන්න.',
  },
  loyalty: { title: 'පක්ෂපාතී ලකුණු', balance: 'ලකුණු {{points}}' },
  notifications: { title: 'දැනුම්දීම්', markAll: 'සියල්ල කියවූ ලෙස සලකුණු කරන්න' },
  acceptInvite: {
    title: '{{business}} වෙත එක්වන්න',
    fullName: 'ඔබගේ සම්පූර්ණ නම',
    submit: 'ව්‍යාපාරයට එක්වන්න',
  },
};
