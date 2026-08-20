import type { FlightOption } from "./types";

export type DatePrice = {
  date: string;
  price: number | null;
};

// Cheapest acceptable one-way price per date for one route. Null means no
// acceptable flight that day.
export function cheapestPerDate(
  options: FlightOption[],
  dates: string[],
  directOnly: boolean,
  maxLegHours?: number
): DatePrice[] {
  const maxMinutes = maxLegHours === undefined ? Infinity : maxLegHours * 60;
  return dates.map((date) => {
    let price: number | null = null;
    for (const option of options) {
      if (option.date !== date) continue;
      if (directOnly && option.stops !== 0) continue;
      if (option.durationMinutes > maxMinutes) continue;
      if (price === null || option.price < price) price = option.price;
    }
    return { date, price };
  });
}

export function optionsCurrency(options: FlightOption[]): string | null {
  return options.length > 0 ? options[0].currency : null;
}
