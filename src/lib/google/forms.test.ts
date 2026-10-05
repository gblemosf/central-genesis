import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractGoogleFormId,
  fetchGoogleFormResponsePage,
  normalizeQuestions,
  normalizeResponses,
} from "@/lib/google/forms";
import { answerText } from "@/lib/form-table";
import { fetchLinkedSheet, sheetColumn } from "@/lib/google/sheets";
afterEach(() => vi.unstubAllGlobals());

describe("Google Forms identifiers", () => {
  const formId = "1aqPVfTzG5eAxg311Iamp4TVQ9vbNmOik_jibb9lyOFU";

  it("extracts the API identifier from an editor link or a pasted ID", () => {
    expect(extractGoogleFormId(`https://docs.google.com/forms/d/${formId}/edit?usp=sharing`)).toBe(formId);
    expect(extractGoogleFormId(`  ${formId}  `)).toBe(formId);
  });

  it("rejects published links with actionable guidance instead of using the responder ID", () => {
    const publishedUrl = "https://docs.google.com/forms/d/e/1FAIpQLScnsgBQaqYJov2002oLydh5uEqSLg3cGbBF6V46EtlG3EMpiA/viewform";
    expect(() => extractGoogleFormId(publishedUrl)).toThrow(/link de preenchimento.*\/edit/);
    try {
      extractGoogleFormId(publishedUrl);
    } catch (error) {
      expect(error).toHaveProperty("status", 400);
    }
  });
});

describe("dynamic form columns", () => {
  const questions = normalizeQuestions({
    formId: "form",
    items: [
      {
        title: "Nome",
        questionItem: { question: { questionId: "q1", textQuestion: {} } },
      },
      {
        title: "Nome",
        questionItem: { question: { questionId: "q2", textQuestion: {} } },
      },
      {
        title: "Avaliação",
        questionGroupItem: {
          questions: [
            { questionId: "row1", rowQuestion: { title: "Atendimento" } },
            { questionId: "row2", rowQuestion: { title: "Curso" } },
          ],
          grid: { columns: { type: "RADIO", options: [{ value: "Bom" }] } },
        },
      },
      {
        title: "Nova pergunta",
        questionItem: { question: { questionId: "q3", ratingQuestion: {} } },
      },
    ],
  });
  it("keeps duplicate titles separate, expands grid rows and follows question order", () => {
    expect(questions.map((q) => q.title)).toEqual([
      "Nome",
      "Nome",
      "Avaliação [Atendimento]",
      "Avaliação [Curso]",
      "Nova pergunta",
    ]);
    expect(questions.map((q) => q.questionId)).toEqual([
      "q1",
      "q2",
      "row1",
      "row2",
      "q3",
    ]);
    expect(questions.at(-1)?.type).toBe("rating");
  });
  it("preserves multiple choices, removed question IDs, empty answers and zero scores", () => {
    const response = normalizeResponses(
      [
        {
          responseId: "r",
          createTime: "2026-09-01T10:00:00Z",
          totalScore: 0,
          answers: {
            q1: { textAnswers: { answers: [{ value: "A" }, { value: "B" }] } },
            removed: { textAnswers: { answers: [{ value: "Histórico" }] } },
          },
        },
      ],
      questions,
    )[0];
    expect(response.totalScore).toBe(0);
    expect(response.answers.map((a) => a.questionId)).toEqual([
      "q1",
      "removed",
    ]);
    expect(answerText(response.answers[0].values)).toBe("A; B");
    expect(answerText([0, false])).toBe("0; false");
  });
  it("returns a resumable cursor instead of silently truncating large imports", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ responses: [], nextPageToken: "next" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchGoogleFormResponsePage(
      "form",
      "test-token",
      questions,
      "2026-09-01T10:00:00Z",
      "previous",
    );
    expect(result.nextPageToken).toBe("next");
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get("pageToken")).toBe("previous");
    expect(url.searchParams.get("filter")).toBe(
      "timestamp > 2026-09-01T10:00:00.000Z",
    );
  });
  it("reads sheet formula results and manual columns without collapsing repeated titles", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          properties: { title: "Planilha" },
          sheets: [
            {
              properties: {
                sheetId: 12,
                title: "D'água",
                sheetType: "GRID",
                gridProperties: { rowCount: 1000, columnCount: 30 },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          valueRanges: [
            { values: [["Resposta", "Resposta", "Fórmula", "Observação"]] },
            { values: [["Um", "Dois", "R$ 41,82", "Manual"]] },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const sheet = await fetchLinkedSheet("linked", "test-token", 12);
    expect(sheet.headers).toEqual([
      "Resposta",
      "Resposta",
      "Fórmula",
      "Observação",
    ]);
    expect(sheet.rows[0].values).toEqual(["Um", "Dois", "R$ 41,82", "Manual"]);
    const url = fetchMock.mock.calls[1][0] as URL;
    expect(url.searchParams.get("valueRenderOption")).toBe("FORMATTED_VALUE");
    expect(url.searchParams.getAll("ranges")).toContain("'D''água'!A1:AD1");
    expect(sheetColumn(26)).toBe("AA");
    expect(sheet.hasMore).toBe(true);
  });
});
