export const isConfirmationMessage = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  const yesWords = ["כן", "מאשרת", "תאשר", "תעשה את זה", "סגור"];
  return yesWords.includes(normalized);
};
