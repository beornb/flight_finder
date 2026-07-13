import { FlightSearch } from "@/components/flight-search";

export default function Home() {
  return (
    <div className="flex-1 bg-zinc-50 dark:bg-black">
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Flight Finder
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Tell us roughly where and when you want to go. We compare many airports, dates, and fare
            strategies behind the scenes to find the cheapest trips — anything that needs a
            self-managed airport change is clearly flagged.
          </p>
        </header>
        <FlightSearch />
      </main>
    </div>
  );
}
