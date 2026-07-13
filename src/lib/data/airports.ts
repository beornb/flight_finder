export type Airport = {
  iata: string;
  name: string;
  city: string;
  country: string;
};

// Static country → airport mapping for the MVP, ordered by rough passenger volume.
// Replaces a live provider airport-lookup API; extend as needed.
const AIRPORTS: Airport[] = [
  { iata: "VIE", name: "Vienna International", city: "Vienna", country: "AT" },
  { iata: "SZG", name: "Salzburg", city: "Salzburg", country: "AT" },
  { iata: "INN", name: "Innsbruck", city: "Innsbruck", country: "AT" },
  { iata: "GRZ", name: "Graz", city: "Graz", country: "AT" },
  { iata: "BRU", name: "Brussels", city: "Brussels", country: "BE" },
  { iata: "CRL", name: "Brussels South Charleroi", city: "Charleroi", country: "BE" },
  { iata: "SOF", name: "Sofia", city: "Sofia", country: "BG" },
  { iata: "VAR", name: "Varna", city: "Varna", country: "BG" },
  { iata: "ZRH", name: "Zurich", city: "Zurich", country: "CH" },
  { iata: "GVA", name: "Geneva", city: "Geneva", country: "CH" },
  { iata: "BSL", name: "EuroAirport Basel", city: "Basel", country: "CH" },
  { iata: "LCA", name: "Larnaca", city: "Larnaca", country: "CY" },
  { iata: "PFO", name: "Paphos", city: "Paphos", country: "CY" },
  { iata: "PRG", name: "Vaclav Havel Prague", city: "Prague", country: "CZ" },
  { iata: "FRA", name: "Frankfurt", city: "Frankfurt", country: "DE" },
  { iata: "MUC", name: "Munich", city: "Munich", country: "DE" },
  { iata: "BER", name: "Berlin Brandenburg", city: "Berlin", country: "DE" },
  { iata: "DUS", name: "Dusseldorf", city: "Dusseldorf", country: "DE" },
  { iata: "HAM", name: "Hamburg", city: "Hamburg", country: "DE" },
  { iata: "CPH", name: "Copenhagen", city: "Copenhagen", country: "DK" },
  { iata: "BLL", name: "Billund", city: "Billund", country: "DK" },
  { iata: "TLL", name: "Tallinn", city: "Tallinn", country: "EE" },
  { iata: "MAD", name: "Madrid Barajas", city: "Madrid", country: "ES" },
  { iata: "BCN", name: "Barcelona El Prat", city: "Barcelona", country: "ES" },
  { iata: "PMI", name: "Palma de Mallorca", city: "Palma", country: "ES" },
  { iata: "AGP", name: "Malaga Costa del Sol", city: "Malaga", country: "ES" },
  { iata: "VLC", name: "Valencia", city: "Valencia", country: "ES" },
  { iata: "HEL", name: "Helsinki Vantaa", city: "Helsinki", country: "FI" },
  { iata: "CDG", name: "Paris Charles de Gaulle", city: "Paris", country: "FR" },
  { iata: "ORY", name: "Paris Orly", city: "Paris", country: "FR" },
  { iata: "NCE", name: "Nice Cote d'Azur", city: "Nice", country: "FR" },
  { iata: "LYS", name: "Lyon Saint-Exupery", city: "Lyon", country: "FR" },
  { iata: "MRS", name: "Marseille Provence", city: "Marseille", country: "FR" },
  { iata: "LHR", name: "London Heathrow", city: "London", country: "GB" },
  { iata: "LGW", name: "London Gatwick", city: "London", country: "GB" },
  { iata: "STN", name: "London Stansted", city: "London", country: "GB" },
  { iata: "LTN", name: "London Luton", city: "London", country: "GB" },
  { iata: "MAN", name: "Manchester", city: "Manchester", country: "GB" },
  { iata: "EDI", name: "Edinburgh", city: "Edinburgh", country: "GB" },
  { iata: "ATH", name: "Athens Eleftherios Venizelos", city: "Athens", country: "GR" },
  { iata: "SKG", name: "Thessaloniki Makedonia", city: "Thessaloniki", country: "GR" },
  { iata: "HER", name: "Heraklion", city: "Heraklion", country: "GR" },
  { iata: "ZAG", name: "Zagreb Franjo Tudman", city: "Zagreb", country: "HR" },
  { iata: "SPU", name: "Split", city: "Split", country: "HR" },
  { iata: "DBV", name: "Dubrovnik", city: "Dubrovnik", country: "HR" },
  { iata: "BUD", name: "Budapest Ferenc Liszt", city: "Budapest", country: "HU" },
  { iata: "DUB", name: "Dublin", city: "Dublin", country: "IE" },
  { iata: "ORK", name: "Cork", city: "Cork", country: "IE" },
  { iata: "KEF", name: "Keflavik", city: "Reykjavik", country: "IS" },
  { iata: "FCO", name: "Rome Fiumicino", city: "Rome", country: "IT" },
  { iata: "MXP", name: "Milan Malpensa", city: "Milan", country: "IT" },
  { iata: "VCE", name: "Venice Marco Polo", city: "Venice", country: "IT" },
  { iata: "NAP", name: "Naples", city: "Naples", country: "IT" },
  { iata: "BGY", name: "Milan Bergamo", city: "Bergamo", country: "IT" },
  { iata: "HND", name: "Tokyo Haneda", city: "Tokyo", country: "JP" },
  { iata: "NRT", name: "Tokyo Narita", city: "Tokyo", country: "JP" },
  { iata: "KIX", name: "Osaka Kansai", city: "Osaka", country: "JP" },
  { iata: "FUK", name: "Fukuoka", city: "Fukuoka", country: "JP" },
  { iata: "CTS", name: "Sapporo New Chitose", city: "Sapporo", country: "JP" },
  { iata: "VNO", name: "Vilnius", city: "Vilnius", country: "LT" },
  { iata: "LUX", name: "Luxembourg Findel", city: "Luxembourg", country: "LU" },
  { iata: "RIX", name: "Riga", city: "Riga", country: "LV" },
  { iata: "MLA", name: "Malta International", city: "Valletta", country: "MT" },
  { iata: "AMS", name: "Amsterdam Schiphol", city: "Amsterdam", country: "NL" },
  { iata: "EIN", name: "Eindhoven", city: "Eindhoven", country: "NL" },
  { iata: "OSL", name: "Oslo Gardermoen", city: "Oslo", country: "NO" },
  { iata: "BGO", name: "Bergen Flesland", city: "Bergen", country: "NO" },
  { iata: "WAW", name: "Warsaw Chopin", city: "Warsaw", country: "PL" },
  { iata: "KRK", name: "Krakow John Paul II", city: "Krakow", country: "PL" },
  { iata: "GDN", name: "Gdansk Lech Walesa", city: "Gdansk", country: "PL" },
  { iata: "LIS", name: "Lisbon Humberto Delgado", city: "Lisbon", country: "PT" },
  { iata: "OPO", name: "Porto Francisco Sa Carneiro", city: "Porto", country: "PT" },
  { iata: "FAO", name: "Faro", city: "Faro", country: "PT" },
  { iata: "FNC", name: "Madeira Cristiano Ronaldo", city: "Funchal", country: "PT" },
  { iata: "OTP", name: "Bucharest Henri Coanda", city: "Bucharest", country: "RO" },
  { iata: "CLJ", name: "Cluj Avram Iancu", city: "Cluj-Napoca", country: "RO" },
  { iata: "BEG", name: "Belgrade Nikola Tesla", city: "Belgrade", country: "RS" },
  { iata: "ARN", name: "Stockholm Arlanda", city: "Stockholm", country: "SE" },
  { iata: "GOT", name: "Gothenburg Landvetter", city: "Gothenburg", country: "SE" },
  { iata: "LJU", name: "Ljubljana Joze Pucnik", city: "Ljubljana", country: "SI" },
  { iata: "BTS", name: "Bratislava", city: "Bratislava", country: "SK" },
  { iata: "IST", name: "Istanbul", city: "Istanbul", country: "TR" },
  { iata: "SAW", name: "Istanbul Sabiha Gokcen", city: "Istanbul", country: "TR" },
  { iata: "AYT", name: "Antalya", city: "Antalya", country: "TR" },
  { iata: "JNB", name: "O.R. Tambo International", city: "Johannesburg", country: "ZA" },
  { iata: "CPT", name: "Cape Town International", city: "Cape Town", country: "ZA" },
];

const COUNTRY_NAMES: Record<string, string> = {
  AT: "Austria",
  BE: "Belgium",
  BG: "Bulgaria",
  CH: "Switzerland",
  CY: "Cyprus",
  CZ: "Czechia",
  DE: "Germany",
  DK: "Denmark",
  EE: "Estonia",
  ES: "Spain",
  FI: "Finland",
  FR: "France",
  GB: "United Kingdom",
  GR: "Greece",
  HR: "Croatia",
  HU: "Hungary",
  IE: "Ireland",
  IS: "Iceland",
  IT: "Italy",
  JP: "Japan",
  LT: "Lithuania",
  LU: "Luxembourg",
  LV: "Latvia",
  MT: "Malta",
  NL: "Netherlands",
  NO: "Norway",
  PL: "Poland",
  PT: "Portugal",
  RO: "Romania",
  RS: "Serbia",
  SE: "Sweden",
  SI: "Slovenia",
  SK: "Slovakia",
  TR: "Turkey",
  ZA: "South Africa",
};

export type MetroArea = {
  // IATA metropolitan city code (e.g. LON, TYO).
  code: string;
  name: string;
  country: string;
  airports: string[];
  // Extra spellings the location search should match (e.g. "Tokio").
  aliases: string[];
};

// City-level search targets that expand to all their airports.
const METRO_AREAS: MetroArea[] = [
  {
    code: "LON",
    name: "London",
    country: "GB",
    airports: ["LHR", "LGW", "STN", "LTN"],
    aliases: [],
  },
  {
    code: "TYO",
    name: "Tokyo",
    country: "JP",
    airports: ["HND", "NRT"],
    aliases: ["Tokio"],
  },
];

export function metroAreas(): MetroArea[] {
  return METRO_AREAS;
}

export function findMetroArea(code: string): MetroArea | undefined {
  return METRO_AREAS.find((metro) => metro.code === code);
}

// A location code from an airport slot: either a metro code covering several
// airports or a single airport code.
export function resolveLocationAirports(code: string): string[] {
  return findMetroArea(code)?.airports ?? [code];
}

// Large connection-friendly airports used for the separate-ticket fallback.
export const HUB_AIRPORTS = ["FRA", "AMS", "CDG", "MUC", "MAD", "FCO", "ZRH", "VIE", "IST"];

export function airportsForCountry(countryCode: string, limit = 4): Airport[] {
  return AIRPORTS.filter((a) => a.country === countryCode).slice(0, limit);
}

export function findAirport(iata: string): Airport | undefined {
  return AIRPORTS.find((a) => a.iata === iata);
}

export function allAirports(): Airport[] {
  return AIRPORTS;
}

export function supportedCountries(): { code: string; name: string }[] {
  return Object.entries(COUNTRY_NAMES)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}
