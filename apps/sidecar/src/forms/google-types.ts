export interface RawDriveFile {
  readonly id: string;
  readonly name: string;
  readonly modifiedTime?: string;
}

export interface RawDriveFileList {
  readonly files: readonly RawDriveFile[];
  readonly nextCursor?: string;
  readonly incompleteSearch?: boolean;
  readonly payloadBytes?: number;
}

export interface RawGoogleFormInfo {
  readonly title: string;
  readonly description?: string;
  readonly documentTitle?: string;
}

export interface RawGoogleOption {
  readonly value: string;
  readonly isOther?: boolean;
  readonly goToAction?: string;
  readonly goToSectionId?: string;
}

export interface RawGoogleChoiceQuestion {
  readonly type: string;
  readonly options: readonly RawGoogleOption[];
  readonly shuffle?: boolean;
}

export interface RawGoogleTextQuestion {
  readonly paragraph?: boolean;
}

export interface RawGoogleScaleQuestion {
  readonly low: number;
  readonly high: number;
  readonly lowLabel?: string;
  readonly highLabel?: string;
}

export interface RawGoogleDateQuestion {
  readonly includeTime?: boolean;
  readonly includeYear?: boolean;
}

export interface RawGoogleTimeQuestion {
  readonly duration?: boolean;
}

export interface RawGoogleFileUploadQuestion {
  readonly types?: readonly string[];
  readonly maxFiles?: number;
  readonly maxFileSize?: string;
}

export interface RawGoogleRowQuestion {
  readonly title: string;
}

export interface RawGoogleRatingQuestion {
  readonly ratingScaleLevel: number;
  readonly iconType: string;
}

export interface RawGoogleQuestion {
  readonly questionId: string;
  readonly required?: boolean;
  readonly choiceQuestion?: RawGoogleChoiceQuestion;
  readonly textQuestion?: RawGoogleTextQuestion;
  readonly scaleQuestion?: RawGoogleScaleQuestion;
  readonly dateQuestion?: RawGoogleDateQuestion;
  readonly timeQuestion?: RawGoogleTimeQuestion;
  readonly fileUploadQuestion?: RawGoogleFileUploadQuestion;
  readonly rowQuestion?: RawGoogleRowQuestion;
  readonly ratingQuestion?: RawGoogleRatingQuestion;
}

export interface RawGoogleQuestionItem {
  readonly question: RawGoogleQuestion;
}

export interface RawGoogleGrid {
  readonly columns: RawGoogleChoiceQuestion;
  readonly shuffleQuestions?: boolean;
}

export interface RawGoogleQuestionGroupItem {
  readonly questions: readonly RawGoogleQuestion[];
  readonly grid?: RawGoogleGrid;
}

export interface RawGoogleItem {
  readonly itemId?: string;
  readonly title?: string;
  readonly description?: string;
  readonly questionItem?: RawGoogleQuestionItem;
  readonly questionGroupItem?: RawGoogleQuestionGroupItem;
  readonly pageBreakItem?: Record<string, never>;
  readonly textItem?: Record<string, never>;
  readonly imageItem?: Record<string, unknown>;
  readonly videoItem?: Record<string, unknown>;
}

export interface RawGoogleForm {
  readonly formId: string;
  readonly info: RawGoogleFormInfo;
  readonly items: readonly RawGoogleItem[];
  readonly payloadBytes?: number;
}

export interface RawGoogleTextAnswer {
  readonly value: string;
}

export interface RawGoogleFileUploadAnswer {
  readonly fileId?: string;
  readonly fileName?: string;
  readonly mimeType?: string;
}

export interface RawGoogleAnswer {
  readonly questionId?: string;
  readonly textAnswers?: {
    readonly answers: readonly RawGoogleTextAnswer[];
  };
  readonly fileUploadAnswers?: {
    readonly answers: readonly RawGoogleFileUploadAnswer[];
  };
}

export interface RawGoogleFormResponse {
  readonly responseId: string;
  readonly createTime?: string;
  readonly lastSubmittedTime?: string;
  readonly answers?: Readonly<Record<string, RawGoogleAnswer>>;
}

export interface RawGoogleFormResponsePage {
  readonly responses: readonly RawGoogleFormResponse[];
  readonly nextPageToken?: string;
  readonly payloadBytes?: number;
}
