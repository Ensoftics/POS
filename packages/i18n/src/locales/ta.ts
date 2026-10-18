import type { PartialTranslation } from './en';

/**
 * Tamil — DRAFT. Must be reviewed by a native speaker before launch
 * (see docs/localization.md). Missing keys fall back to English.
 */
export const ta: PartialTranslation = {
  common: {
    loading: 'ஏற்றப்படுகிறது…',
    retry: 'மீண்டும் முயற்சிக்கவும்',
    continue: 'தொடரவும்',
    signOut: 'வெளியேறு',
    optional: 'விருப்பத்தேர்வு',
    skipToContent: 'முக்கிய உள்ளடக்கத்திற்குச் செல்லவும்',
    showPassword: 'கடவுச்சொல்லைக் காட்டு',
    hidePassword: 'கடவுச்சொல்லை மறை',
  },
  language: { label: 'மொழி' },
  auth: {
    login: {
      title: 'உள்நுழைக',
      subtitle: 'மீண்டும் வருக. உங்கள் வணிகத்தில் உள்நுழையவும்.',
      email: 'மின்னஞ்சல்',
      password: 'கடவுச்சொல்',
      submit: 'உள்நுழைக',
      forgot: 'கடவுச்சொல் மறந்துவிட்டதா?',
      noAccount: 'Ensoftic POS-க்கு புதியவரா?',
      register: 'வணிகக் கணக்கை உருவாக்கவும்',
      chooseBusiness: 'ஒரு வணிகத்தைத் தேர்ந்தெடுக்கவும்',
      sessionEnded: 'உங்கள் அமர்வு முடிந்தது. மீண்டும் உள்நுழையவும்.',
      passwordReset: 'கடவுச்சொல் புதுப்பிக்கப்பட்டது. புதிய கடவுச்சொல்லுடன் உள்நுழையவும்.',
    },
    register: {
      title: 'உங்கள் வணிகக் கணக்கை உருவாக்கவும்',
      businessName: 'வணிகப் பெயர்',
      ownerFullName: 'உங்கள் முழுப் பெயர்',
      email: 'மின்னஞ்சல்',
      password: 'கடவுச்சொல்',
      passwordHint: 'குறைந்தது 10 எழுத்துகள்.',
      submit: 'கணக்கை உருவாக்கு',
      haveAccount: 'ஏற்கனவே கணக்கு உள்ளதா?',
      signIn: 'உள்நுழைக',
    },
    forgot: {
      title: 'கடவுச்சொல்லை மீட்டமைக்கவும்',
      submit: 'மீட்டமைப்பு இணைப்பை அனுப்பு',
      sentTitle: 'உங்கள் மின்னஞ்சலைச் சரிபார்க்கவும்',
      backToLogin: 'உள்நுழைவுக்குத் திரும்பு',
    },
    reset: {
      title: 'புதிய கடவுச்சொல்லைத் தேர்ந்தெடுக்கவும்',
      password: 'புதிய கடவுச்சொல்',
      confirm: 'புதிய கடவுச்சொல்லை உறுதிப்படுத்தவும்',
      mismatch: 'கடவுச்சொற்கள் பொருந்தவில்லை',
      submit: 'கடவுச்சொல்லைப் புதுப்பி',
      requestNew: 'புதிய இணைப்பைக் கோரவும்',
    },
  },
  onboarding: {
    title: 'உங்கள் வணிகத்தை அமைக்கவும்',
    businessName: 'வணிகப் பெயர்',
    businessType: 'வணிக வகை',
    contactPhone: 'தொலைபேசி எண்',
    submit: 'அமைப்பை முடிக்கவும்',
  },
  businessTypes: {
    COSMETICS: { label: 'அழகுசாதனப் பொருட்கள்' },
    TEXTILE: { label: 'ஜவுளி மற்றும் ஆடைகள்' },
    GENERAL_RETAIL: { label: 'பொது சில்லறை விற்பனை' },
  },
  roles: {
    OWNER: 'உரிமையாளர்',
    MANAGER: 'மேலாளர்',
    CASHIER: 'காசாளர்',
    INVENTORY_STAFF: 'சரக்கு ஊழியர்',
  },
  paymentMethods: {
    CASH: 'பணம்',
    CARD: 'அட்டை',
    BANK_TRANSFER: 'வங்கி பரிமாற்றம்',
    OTHER: 'மற்றவை',
    ACCOUNT: 'கணக்கில்',
  },
  pos: {
    title: 'விற்பனை',
    subtotal: 'துணை மொத்தம்',
    discount: 'தள்ளுபடி',
    tax: 'வரி',
    total: 'மொத்தம்',
    pay: 'செலுத்து',
    change: 'மீதி',
    complete: 'விற்பனையை முடிக்கவும்',
    newSale: 'புதிய விற்பனை',
    print: 'ரசீதை அச்சிடு',
  },
  approval: {
    title: 'மேலாளர் ஒப்புதல்',
    approve: 'ஒப்புதல் அளி',
    cancel: 'ரத்து செய்',
  },
  nav: { dashboard: 'முகப்புப் பலகை', auditLog: 'செயல்பாட்டுப் பதிவு', settings: 'அமைப்புகள்' },
  validation: {
    required: 'இந்தப் புலம் தேவை',
    email: { invalid: 'சரியான மின்னஞ்சல் முகவரியை உள்ளிடவும்' },
    password: { too_short: 'குறைந்தது 10 எழுத்துகளைப் பயன்படுத்தவும்' },
  },
  errors: {
    generic: 'ஏதோ தவறு நடந்துவிட்டது. மீண்டும் முயற்சிக்கவும்.',
    INVALID_CREDENTIALS: 'மின்னஞ்சல் அல்லது கடவுச்சொல் தவறானது.',
    NETWORK_ERROR: 'சேவையகத்தை அடைய முடியவில்லை. உங்கள் இணைப்பைச் சரிபார்க்கவும்.',
    DEVICE_REVOKED:
      'இந்தச் சாதனம் வணிகத்தால் தடுக்கப்பட்டுள்ளது. மீண்டும் அனுமதிக்க உரிமையாளர் அல்லது மேலாளரைக் கேளுங்கள்.',
    BRANCH_NOT_ALLOWED: 'இந்தக் கிளைக்கு உங்களுக்கு அணுகல் இல்லை.',
    SUBSCRIPTION_INACTIVE: 'திட்டம் செலுத்தப்படும் வரை இந்தக் கணக்கு படிக்க மட்டுமே.',
    PLAN_LIMIT_REACHED:
      'உங்கள் திட்டத்தில் இவை மேலும் சேர்க்கப்படவில்லை. திட்டம் & கட்டணத்தில் மேம்படுத்தவும்.',
    INVITATION_INVALID:
      'இந்த அழைப்பு இணைப்பு செல்லாதது, பயன்படுத்தப்பட்டது அல்லது காலாவதியானது. புதியதைக் கேளுங்கள்.',
  },
  loyalty: { title: 'விசுவாசப் புள்ளிகள்', balance: '{{points}} புள்ளிகள்' },
  notifications: { title: 'அறிவிப்புகள்', markAll: 'அனைத்தையும் படித்ததாகக் குறி' },
  acceptInvite: {
    title: '{{business}} இல் இணையுங்கள்',
    fullName: 'உங்கள் முழுப் பெயர்',
    submit: 'வணிகத்தில் இணை',
  },
};
