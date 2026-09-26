export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d@$!%*?&#^()_\-+={}[\]:;"'<>,.?/~`|\\]{8,}$/;

export const PASSWORD_VALIDATION_MESSAGE =
  'يجب ألا تقل كلمة المرور عن 8 أحرف وتحتوي على حرف كبير (A-Z) وحرف صغير (a-z) ورقم (0-9) على الأقل.';

export const PHONE_REGEX = /^(01[0125][0-9]{8})$/;

export const PHONE_VALIDATION_MESSAGE =
  'رقم الهاتف يجب أن يكون رقماً مصرياً صحيحاً مكوناً من 11 رقماً (يبدأ بـ 010 أو 011 أو 012 أو 015).';

export const COOKIE_NAME_REFRESH_TOKEN = 'refreshToken';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
