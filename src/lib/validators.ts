import { z } from "zod";
import {
  funnelStageTypes,
  operationalProviders,
  salesProviders,
} from "@/lib/domain";

const stageColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i)
  .nullable();

const projectFunnelStageSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(funnelStageTypes),
  color: stageColorSchema.optional().default(null),
  productId: z.uuid().nullable(),
});

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
    salesProvider: z.enum(salesProviders),
    salesConnectionId: z.uuid(),
    metaConnectionId: z.uuid().nullable().optional(),
    metaAdAccountExternalId: z.string().trim().max(100).nullable().optional(),
    monthlyTarget: z.number().nonnegative().max(100_000_000),
    marginTarget: z.number().min(-100).max(100),
    funnel: z
      .array(projectFunnelStageSchema)
      .min(1)
      .max(100)
      .refine(
        (stages) => {
          const productIds = stages
            .map((stage) => stage.productId)
            .filter((productId): productId is string => Boolean(productId));
          return new Set(productIds).size === productIds.length;
        },
        "Cada produto pode aparecer apenas uma vez no funil.",
      ),
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
  provider: z.enum(operationalProviders),
  businessId: z.string().trim().max(100).nullable().optional(),
  appId: z.string().trim().max(100).nullable().optional(),
  systemUserId: z.string().trim().max(100).nullable().optional(),
});

export const connectionCredentialFieldsSchema = z
  .object({
    accessToken: z.string().trim().min(8).max(16_384).optional(),
    clientId: z.string().trim().min(2).max(1_000).optional(),
    clientSecret: z.string().trim().min(8).max(16_384).optional(),
    basicToken: z.string().trim().min(8).max(16_384).optional(),
    hottok: z.string().trim().min(8).max(16_384).optional(),
    accountId: z.string().trim().min(2).max(1_000).optional(),
    webhookToken: z.string().trim().min(8).max(16_384).optional(),
  })
  .strict();

const requiredCredentialFields = {
  meta: ["accessToken"],
  hotmart: ["clientId", "clientSecret", "basicToken", "hottok"],
  eduzz: ["accessToken"],
  kiwify: ["clientId", "clientSecret", "accountId"],
  hubla: ["webhookToken"],
} as const;

export const credentialInputSchema = z.object({
  credentials: connectionCredentialFieldsSchema.refine(
    (credentials) => Object.keys(credentials).length > 0,
    "Informe ao menos uma credencial.",
  ),
});

export const connectionWithCredentialInputSchema = connectionInputSchema
  .extend({ credentials: connectionCredentialFieldsSchema })
  .superRefine((input, context) => {
    for (const field of requiredCredentialFields[input.provider]) {
      if (!input.credentials[field]) {
        context.addIssue({
          code: "custom",
          path: ["credentials", field],
          message: "Credencial obrigatoria para esta plataforma.",
        });
      }
    }
  });

export const connectionUpdateInputSchema = connectionInputSchema
  .omit({ provider: true })
  .extend({
    credentials: credentialInputSchema.shape.credentials.optional(),
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

export const googleFormSyncInputSchema = z
  .object({
    connectionId: z.uuid().nullable().optional(),
    formUrl: z.string().trim().min(5).max(1_000).optional(),
    googleFormId: z.uuid().optional(),
    fullSync: z.boolean().optional().default(true),
  })
  .refine((input) => Boolean(input.formUrl) !== Boolean(input.googleFormId), {
    message: "Informe uma URL nova ou um formulario ja vinculado.",
    path: ["formUrl"],
  });

export const projectUpdateInputSchema = z.object({
  monthlyTarget: z.number().nonnegative().max(100_000_000),
  marginTarget: z.number().min(-100).max(100),
  status: z.enum(["draft", "active", "paused", "archived"]),
});

export const projectDeleteInputSchema = z.union([
  z.object({ legacy: z.literal(false).default(false) }).strict(),
  z
    .object({
      legacy: z.literal(true),
      name: z.string().trim().min(1).max(120),
    })
    .strict(),
]);

export const funnelStageInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(funnelStageTypes),
  color: stageColorSchema.optional().default(null),
});

export const funnelStageUpdateInputSchema = funnelStageInputSchema.extend({
  archived: z.boolean().optional(),
});

export const funnelStageOrderInputSchema = z.object({
  stageIds: z
    .array(z.uuid())
    .max(100)
    .refine(
      (stageIds) => new Set(stageIds).size === stageIds.length,
      "Cada etapa pode aparecer apenas uma vez.",
    ),
});

const productFields = {
  externalId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(2).max(160),
  price: z.number().nonnegative().max(100_000_000),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  funnelStageId: z.uuid().nullable(),
};

export const projectProductInputSchema = z.object({
  ...productFields,
  connectionId: z.uuid().nullable(),
});

export const projectProductUpdateInputSchema = z.object(productFields);

export const projectProductArchiveInputSchema = z.object({
  archived: z.boolean(),
});

const projectMetricMoney = z.number().nonnegative().max(100_000_000);
const projectMetricCount = z.number().nonnegative().max(100_000_000);

export const projectMetricConfigInputSchema = z
  .object({
    automaticMetrics: z.partialRecord(z.enum([
      "baseCpa", "ticketNetPrice", "formationNetPrice", "orderBump1NetPrice",
      "orderBump2NetPrice", "orderBump3NetPrice", "historicalTicketSales", "historicalFormationSales",
    ]), z.boolean()).optional(),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    trafficFeePercent: z.number().min(0).max(100),
    manychatCost: projectMetricMoney,
    companyCosts: projectMetricMoney,
    otherCosts: projectMetricMoney,
    companySharePercent: z.number().min(0).max(100),
    ticketBudget: projectMetricMoney,
    apiBudget: projectMetricMoney,
    remarketingBudget: projectMetricMoney,
    distributionBudget: projectMetricMoney,
    baseCpa: projectMetricMoney,
    idealCpa: projectMetricMoney,
    historicalAttendance: projectMetricCount,
    historicalTicketSales: projectMetricCount,
    historicalFormationSales: projectMetricCount,
    studentGroupLeads: projectMetricCount,
    studentGroupTarget: projectMetricCount,
    buyerGroupLeads: projectMetricCount,
    buyerGroupTarget: projectMetricCount,
    captureLeads: projectMetricCount,
    captureTarget: projectMetricCount,
    ticketNetPrice: projectMetricMoney,
    orderBump1NetPrice: projectMetricMoney,
    orderBump2NetPrice: projectMetricMoney,
    orderBump3NetPrice: projectMetricMoney,
    formationNetPrice: projectMetricMoney,
    ticketProductId: z.uuid().nullable(),
    formationProductId: z.uuid().nullable(),
    downsellProductId: z.uuid().nullable(),
  })
  .superRefine((input, context) => {
    const start = Date.parse(`${input.periodStart}T00:00:00Z`);
    const end = Date.parse(`${input.periodEnd}T00:00:00Z`);
    const days = (end - start) / 86_400_000;

    if (days < 0) {
      context.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "A data final deve ser posterior a inicial.",
      });
    } else if (days > 365) {
      context.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "O periodo deve ter no maximo 366 dias.",
      });
    }

    const productIds = [
      input.ticketProductId,
      input.formationProductId,
      input.downsellProductId,
    ].filter((productId): productId is string => Boolean(productId));
    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({
        code: "custom",
        path: ["formationProductId"],
        message: "Cada papel deve usar um produto diferente.",
      });
    }
  });
