import app from "./app";

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const server = app.listen(port, () => {
  console.log(`Karen Content Agent is running on http://localhost:${port}`);
});

server.on("error", (error: any) => {
  console.error("Server error:", error);
  process.exit(1);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
