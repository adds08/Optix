import { z } from "zod";

const webSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:4100"),
  NEXT_PUBLIC_APP_NAME: z.string().default("STInventory"),
});

export type WebEnv = z.infer<typeof webSchema>;

export function webEnv(): WebEnv {
  return webSchema.parse({
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  });
}
