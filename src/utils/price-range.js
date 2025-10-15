export function computePriceRange(menu) {
  if (!Array.isArray(menu) || menu.length === 0) {
    return null;
  }

  const numericPrices = menu
    .map((item) => {
      if (!item || typeof item.price !== "string") {
        return null;
      }
      const match = item.price.match(/-?\d+(?:\.\d+)?/);
      if (!match) {
        return null;
      }
      const value = Number.parseFloat(match[0]);
      return Number.isNaN(value) ? null : value;
    })
    .filter((value) => value !== null);

  if (numericPrices.length === 0) {
    return null;
  }

  const min = Math.min(...numericPrices);
  const max = Math.max(...numericPrices);
  const format = (value) =>
    `$${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}`;

  if (Math.abs(min - max) < 0.01) {
    return format(min);
  }

  return `${format(min)}–${format(max)}`;
}
