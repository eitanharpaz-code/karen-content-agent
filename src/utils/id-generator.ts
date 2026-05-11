export const generateContentId = (category: string, index: number): string => {
  const prefixMap: Record<string, string> = {
    cyprus: "CYP",
    wedding: "WED",
    dresses: "DRS",
  };

  const prefix = prefixMap[category.toLowerCase()] ?? "GEN";
  return `${prefix}-${String(index).padStart(3, "0")}`;
};
