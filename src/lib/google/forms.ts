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
      ratingQuestion?: Record<string, unknown>;
    };
  };
  questionGroupItem?: {
    questions?: NonNullable<
      GoogleFormQuestionItem["questionItem"]
    >["question"][];
    grid?: Record<string, unknown>;
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
  linkedSheetId?: string;
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

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("URL do Google Form invalida.", 400);
  }

  if (/\/forms\/d\/e(?:\/|$)/.test(url.pathname)) {
    throw new ApiError(
      "Este é o link de preenchimento. Abra o formulário no Google Forms como editor e copie o endereço que termina em /edit. A conta Google conectada precisa ter acesso ao formulário.",
      400,
    );
  }

  const pathMatch = url.pathname.match(/\/forms\/d\/([^/]+)/);
  if (pathMatch?.[1]) return pathMatch[1];
  const id = url.searchParams.get("id") ?? url.searchParams.get("formId");
  if (id) return id;

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

export function normalizeQuestions(
  form: GoogleForm,
): NormalizedGoogleQuestion[] {
  const result: NormalizedGoogleQuestion[] = [];
  for (const item of form.items ?? []) {
    const questions = item.questionGroupItem?.questions ?? [
      item.questionItem?.question,
    ];
    for (const question of questions) {
      if (!question?.questionId) continue;
      const rowTitle =
        typeof question.rowQuestion?.title === "string"
          ? question.rowQuestion.title
          : "";
      result.push({
        questionId: question.questionId,
        itemId: item.itemId ?? null,
        title:
          rowTitle && item.title?.trim()
            ? `${item.title.trim()} [${rowTitle}]`
            : rowTitle || item.title?.trim() || "Pergunta sem título",
        type: question.ratingQuestion ? "rating" : questionType({ question }),
        position: result.length,
        required: Boolean(question.required),
        configuration: {
          ...question,
          ...(item.questionGroupItem?.grid
            ? { grid: item.questionGroupItem.grid }
            : {}),
        },
      });
    }
  }
  return result;
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

function technicalUtmField(title: string): string | null {
  const match = /^utm[_ ](source|medium|campaign|content|term|id)$/i.exec(title.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

function inferIdentityAndUtm(
  response: GoogleFormResponse,
  questions: NormalizedGoogleQuestion[],
) {
  const byQuestion = new Map(
    questions.map((question) => [question.questionId, question]),
  );
  const identity: Record<string, string> = {};
  const utm: Record<string, string> = {};

  for (const [questionId, answer] of Object.entries(response.answers ?? {})) {
    const question = byQuestion.get(questionId);
    if (!question) continue;
    const value = stringFromAnswer(answer);
    if (!value) continue;

    if (valueMatches(question.title, ["nome", "name"])) identity.name ??= value;
    if (valueMatches(question.title, ["email", "e-mail"]))
      identity.email ??= value;
    if (
      valueMatches(question.title, ["telefone", "celular", "whatsapp", "phone"])
    ) {
      identity.phone ??= value;
    }
    const utmField = technicalUtmField(question.title);
    if (utmField) utm[utmField] ??= value;
  }

  return { identity, utm };
}

export function normalizeResponses(
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
        totalScore:
          typeof response.totalScore === "number" ? response.totalScore : null,
        identity,
        utm,
        answers: Object.entries(response.answers ?? {}).map(
          ([questionId, answer]) => {
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
          },
        ),
      } satisfies NormalizedGoogleResponse;
    })
    .filter((response): response is NormalizedGoogleResponse =>
      Boolean(response),
    );
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
    throw new ApiError(
      data?.error?.message ?? "Google Forms recusou a requisicao.",
      422,
    );
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
    await store.save(
      serializeGoogleCredential(refreshed, credential.refreshToken),
    );
  }

  return callback(accessToken);
}

export async function fetchGoogleForm(formId: string, accessToken: string) {
  const url = new URL(
    `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`,
  );
  const form = await googleFetch<GoogleForm>(url, accessToken);
  const questions = normalizeQuestions(form);
  return {
    formId: form.formId || formId,
    title:
      form.info?.title || form.info?.documentTitle || "Formulario sem titulo",
    responderUri: form.responderUri ?? null,
    revisionId: form.revisionId ?? null,
    linkedSheetId: form.linkedSheetId ?? null,
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
    if (sinceFilter)
      url.searchParams.set("filter", `timestamp > ${sinceFilter}`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await googleFetch<{
      responses?: GoogleFormResponse[];
      nextPageToken?: string;
    }>(url, accessToken);
    responses.push(...(data.responses ?? []));
    pageToken = data.nextPageToken ?? "";
    if (!pageToken) break;
  }

  if (pageToken)
    throw new ApiError(
      "A importação excedeu o limite de páginas. O cursor foi preservado para evitar perda de respostas.",
      422,
    );

  return normalizeResponses(responses, questions);
}

export async function fetchGoogleFormResponsePage(
  formId: string,
  accessToken: string,
  questions: NormalizedGoogleQuestion[],
  since?: string | null,
  pageToken?: string | null,
) {
  const url = new URL(
    `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}/responses`,
  );
  url.searchParams.set("pageSize", "200");
  if (since)
    url.searchParams.set(
      "filter",
      `timestamp > ${new Date(since).toISOString()}`,
    );
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const data = await googleFetch<{
    responses?: GoogleFormResponse[];
    nextPageToken?: string;
  }>(url, accessToken);
  return {
    responses: normalizeResponses(data.responses ?? [], questions),
    nextPageToken: data.nextPageToken ?? null,
  };
}
