import { z } from "zod";
import { providers } from "@/lib/domain";

export const projectInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    expertName: z.string().trim().min(2).max(120),
    expertEmail: z.email().nullable().optional(),
    salesProvider: z.enum(providers).exclude(["meta"]),
    metaConnectionId: z.uuid().nullable().optional(),
    metaAdAccountExternalId: z.string().trim().max(100).nullable().optional(),
    monthlyTarget: z.number().nonnegative().max(100_000_000),
    marginTarget: z.number().min(-100).max(100),
  })
  .refine(
    (input) => Boolean(input.metaConnectionId) === Boolean(input.metaAdAccountExternalId),
    {
      message: "Conexao e conta Meta devem ser informadas juntas.",
      path: ["metaAdAccountExternalId"],
    },
  );

export const connectionInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  provider: z.enum(providers),
  businessId: z.string().trim().max(100).nullable().optional(),
  appId: z.string().trim().max(100).nullable().optional(),
  systemUserId: z.string().trim().max(100).nullable().optional(),
});

export const credentialInputSchema = z.object({
  credential: z.string().min(8).max(16_384),
});

export const connectionWithCredentialInputSchema = connectionInputSchema.extend({
  credential: credentialInputSchema.shape.credential,
});

export const projectMappingsInputSchema = z.object({
  mappings: z
    .array(
      z.object({
        productId: z.uuid(),
        funnelStageId: z.uuid(),
      }),
    )
    .max(500)
    .refine(
      (mappings) => new Set(mappings.map((mapping) => mapping.productId)).size === mappings.length,
      "Cada produto pode aparecer apenas uma vez.",
    ),
});

export const projectMetaAccountInputSchema = z.object({
  providerAccountId: z.uuid().nullable(),
});
