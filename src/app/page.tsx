import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
          School Management System
        </p>
        <h1 className="text-3xl font-bold sm:text-4xl">Blessed Faith Academy</h1>
        <p className="text-muted-foreground">
          The project foundation is set up and running.
        </p>
      </div>
      <Button>Foundation ready</Button>
    </main>
  );
}
