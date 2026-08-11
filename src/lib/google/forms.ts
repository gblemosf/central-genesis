import "server-only";

import crypto from "node:crypto";
import { ApiError } from "@/lib/api-auth";
import {
  decodeGoogleCredential,
  refreshGoogleAccessToken,
  serializeGoogleCredential,
} from "@/lib/google/oauth";

interface GoogleFormQuestionItem {
  itemId?: string;
  title?: string;
  questionItem?: {
    question?: {
      questionId?: string;
      required?: boolean;
      textQuestion?: Record<string, unknown>;
      choiceQuestion?: Record<string, unknown>;
      scaleQuestion?: Record<string, unknown>;
      dateQuestion?: Record<string, unknown>;
      timeQuestion?: Record<string, unknown>;
      fileUploadQuestion?: Record<string, unknown>;
      rowQuestion?: Record<string, unknown>;
    };
  };
}

interface GoogleForm {
  formId: string;
  info?: {
    title?: string;
    documentTitle?: string;
  };
  responderUri?: string;
  revisionId?: string;
  items?: GoogleFormQuestionItem[];
}

interface GoogleFormAnswer {
  questionId?: string;
  textAnswers?: { answers?: { value?: string }[] };
  fileUploadAnswers?: { answers?: Record<string, unknown>[] };
  grade?: Record<string, unknown>;
}

interface GoogleFormResponse {
  responseId?: string;
  createTime?: string;
  lastSubmittedTime?: string;
  respondentEmail?: string;
  totalScore?: number;
  answers?: Record<string, GoogleFormAnswer>;
}

interface GoogleFormsCredentialStore {
  raw: string;
  save: (nextRaw: string) => Promise<void>;
}

export interface NormalizedGoogleQuestion {
  questionId: string;
  itemId: string | null;
  title: string;
  type: string;
  position: number;
  required: boolean;
  configuration: Record<string, unknown>;
}

export interface NormalizedGoogleResponse {
  externalResponseId: string;
  createdAt: string;
  submittedAt: string;
  respondentEmail: string | null;
  totalScore: number | null;
  identity: Record<string, string>;
  utm: Record<string, string>;
  answers: Array<{
    questionId: string;
    values: unknown[];
    grade: Record<string, unknown> | null;
  }>;
}

export function extractGoogleFormId(input: string) {
  const value = input.trim();
  if (!value) throw new ApiError("Informe a URL ou ID do formulario.", 400);

  const directMatch = value.match(/^[a-zA-Z0-9_-]{20,}$/);
  if (directMatch) return value;

  try {
    const url = new URL(value);
    const pathMatch = url.pathname.match(/\/forms\/d\/(?:e\/)?([^/]+)/);
    if (pathMatch?.[1]) return pathMatch[1];
    const id = url.searchParams.get("id") ?? url.searchParams.get("formId");
    if (id) return id;
  } catch {
    // fall through
  }

  throw new ApiError("URL do Google Form invalida.", 400);
}

function questionType(question: GoogleFormQuestionItem["questionItem"]) {
  const item = question?.question;
  if (!item) return "unknown";
  if (item.textQuestion) return "text";
  if (item.choiceQuestion) return "choice";
  if (item.scaleQuestion) return "scale";
  if (item.dateQuestion) return "date";
  if (item.timeQuestion) return "time";
  if (item.fileUploadQuestion) return "file_upload";
  if (item.rowQuestion) return "row";
  return "unknown";
}

function normalizeQuestions(form: GoogleForm): NormalizedGoogleQuestion[] {
  return (form.items ?? [])
    .map((item, position) => {
      const question = item.questionItem?.question;
      const questionId = question?.questionId;
      if (!questionId) return null;
      return {
        questionId,
        itemId: item.itemId ?? null,
        title: item.title?.trim() || "Pergunta sem titulo",
        type: questionType(item.questionItem),
        position,
        required: Boolean(question?.required),
        configuration: question as Record<string, unknown>,
      } satisfies NormalizedGoogleQuestion;
    })
    .filter((item): item is NormalizedGoogleQuestion => Boolean(item));
}

function schemaHash(questions: NormalizedGoogleQuestion[]) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(questions))
    .digest("hex");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringFromAnswer(answer: GoogleFormAnswer | undefined) {
  const text = answer?.textAnswers?.answers?.[0]?.value;
  return typeof text === "string" ? text.trim() : "";
}

function valueMatches(title: string, candidates: string[]) {
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return candidates.some((candidate) => normalized.includes(candidate));
}

function inferIdentityAndUtm(
  response: GoogleFormResponse,
  questions: NormalizedGoogleQuestion[],
) {
  const byQuestion = new Map(questions.map((question) => [question.questionId, question]));
  const identity: Record<string, string> = {};
  const utm: Record<string, string> = {};

  for (const [questionId, answer] of Object.entries(response.answers ?? {})) {
    const question = byQuestion.get(questionId);
    if (!question) continue;
    const value = stringFromAnswer(answer);
    if (!value) continue;

    if (valueMatches(question.title, ["nome", "name"])) identity.name ??= value;
    if (valueMatches(question.title, ["email", "e-mail"])) identity.email ??= value;
    if (valueMatches(question.title, ["telefone", "celular", "whatsapp", "phone"])) {
      identity.phone ??= value;
    }
    if (valueMatches(question.title, ["utm source", "utm_source", "origem"])) {
      utm.source ??= value;
    }
    if (valueMatches(question.title, ["utm medium", "utm_medium", "midia", "meio"])) {
      utm.medium ??= value;
    }
    if (valueMatches(question.title, ["utm campaign", "utm_campaign", "campanha"])) {
      utm.campaign ??= value;
    }
    if (valueMatches(question.title, ["utm term", "utm_term", "termo"])) {
      utm.term ??= value;
    }
    if (valueMatches(question.title, ["utm content", "utm_content", "conteudo"])) {
      utm.content ??= value;
    }
  }

  return { identity, utm };
}

function normalizeResponses(
  responses: GoogleFormResponse[],
  questions: NormalizedGoogleQuestion[],
): NormalizedGoogleResponse[] {
  return responses
    .map((response): NormalizedGoogleResponse | null => {
      const externalResponseId = response.responseId?.trim();
      const createdAt = response.createTime;
      const submittedAt = response.lastSubmittedTime ?? response.createTime;
      if (!externalResponseId || !createdAt || !submittedAt) return null;
      const { identity, utm } = inferIdentityAndUtm(response, questions);
      return {
        externalResponseId,
        createdAt,
        submittedAt,
        respondentEmail: response.respondentEmail ?? null,
        totalScore: typeof response.totalScore === "number" ? response.totalScore : null,
        identity,
        utm,
        answers: Object.entries(response.answers ?? {}).map(([questionId, answer]) => {
          const values: unknown[] =
            answer.textAnswers?.answers?.map((item) => item.value ?? "") ??
            answer.fileUploadAnswers?.answers ??
            [];
          const grade = objectValue(answer.grade);
          return {
            questionId,
            values,
            grade: Object.keys(grade).length ? grade : null,
          };
        }),
      } satisfies NormalizedGoogleResponse;
    })
    .filter((response): response is NormalizedGoogleResponse => Boolean(response));
}

async function googleFetch<T>(url: URL, accessToken: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => null)) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new ApiError(data?.error?.message ?? "Google Forms recusou a requisicao.", 422);
  }
  return data;
}

export async function withGoogleAccessToken<T>(
  store: GoogleFormsCredentialStore,
  callback: (accessToken: string) => Promise<T>,
) {
  const credential = decodeGoogleCredential(store.raw);
  const expiresAt = credential.expiresAt ? Date.parse(credential.expiresAt) : 0;
  let accessToken = credential.accessToken;

  if (!accessToken || expiresAt < Date.now() + 60_000) {
    const refreshed = await refreshGoogleAccessToken(credential.refreshToken);
    accessToken = refreshed.access_token;
    await store.save(serializeGoogleCredential(refreshed, credential.refreshToken));
  }

  return callback(accessToken);
}

export async function fetchGoogleForm(formId: string, accessToken: string) {
  const url = new URL(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`);
  const form = await googleFetch<GoogleForm>(url, accessToken);
  const questions = normalizeQuestions(form);
  return {
    formId: form.formId || formId,
    title: form.info?.title || form.info?.documentTitle || "Formulario sem titulo",
    responderUri: form.responderUri ?? null,
    revisionId: form.revisionId ?? null,
    questions,
    schemaHash: schemaHash(questions),
  };
}

export async function fetchGoogleFormResponses(
  formId: string,
  accessToken: string,
  questions: NormalizedGoogleQuestion[],
  since?: string | null,
) {
  const responses: GoogleFormResponse[] = [];
  let pageToken = "";
  const sinceFilter = since ? new Date(since).toISOString() : null;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL(
      `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}/responses`,
    );
    url.searchParams.set("pageSize", "5000");
    if (sinceFilter) url.searchParams.set("filter", `timestamp > ${sinceFilter}`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await googleFetch<{
      responses?: GoogleFormResponse[];
      nextPageToken?: string;
    }>(url, accessToken);
    responses.push(...(data.responses ?? []));
    pageToken = data.nextPageToken ?? "";
    if (!pageToken) break;
  }

  return normalizeResponses(responses, questions);
}
