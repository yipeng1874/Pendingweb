type CompletionAnswer = {
  answerText?: string | null;
  answerOptions?: unknown;
  isLinkConfirmed?: boolean | null;
  status?: string;
};

const TYPE_LABELS: Record<string, string> = {
  QA: "问答",
  FILL_BLANK: "待办确认",
  SINGLE_CHOICE: "单选",
  MULTI_CHOICE: "多选",
  LINK: "学习链接",
  ATTACHMENT: "图片",
};

const singleLine = (text: string) => text.replace(/\s+/gu, " ").trim();

/** Keep file contents and URLs out of completion messages. Missing optional answers remain explicit. */
export function formatCompletionAnswerLine(
  index: number,
  question: { title: string; itemType: string },
  answer?: CompletionAnswer | null,
) {
  let value = "未填写";
  switch (question.itemType) {
    case "ATTACHMENT":
      value = "请进后台查看";
      break;
    case "QA":
      value = singleLine(answer?.answerText ?? "") || "未填写";
      break;
    case "FILL_BLANK":
      value = singleLine(answer?.answerText ?? "") || (answer?.status === "done" ? "已确认完成" : "未确认");
      break;
    case "SINGLE_CHOICE":
    case "MULTI_CHOICE":
      value = Array.isArray(answer?.answerOptions)
        ? answer.answerOptions.filter((option): option is string => typeof option === "string").map(singleLine).filter(Boolean).join("、") || "未选择"
        : "未选择";
      break;
    case "LINK":
      value = answer?.isLinkConfirmed ? "已确认完成" : "未确认";
      break;
    default:
      value = "请进后台查看";
  }
  return `${index + 1}${TYPE_LABELS[question.itemType] ?? "子任务"}：${singleLine(question.title)} - ${value}`;
}
