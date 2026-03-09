/** Removes undefined values from objects (Firestore rejects undefined) */
export const removeUndefined = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(removeUndefined);
  if (typeof obj !== 'object') return obj;
  const cleaned: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) {
      cleaned[key] = removeUndefined(obj[key]);
    }
  }
  return cleaned;
};

export const getError = (err: any) => {
  if (err.errors && Array.isArray(err.errors)) {
    const errors = err.errors as { longMessage: string }[];
    const errorMessage = errors
      .map((error, index) => `${index + 1}. ${error.longMessage}`)
      .join('\n');
    alert(errorMessage);
  } else {
    alert(err.message || 'An error occurred');
  }
};

// Check if chat is a direct message (not a group)
export const checkIfDMChannel = (chat: { type?: string }) => {
  return chat?.type === 'direct';
};
