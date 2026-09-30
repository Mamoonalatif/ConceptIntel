# Pydantic schemas for AI content generation: the shapes the model output must match (flashcards, MCQs,
# study guides, assignment drafts) and the API request/response bodies. Validators enforce correct *shape*.
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator, model_validator


# The question shapes a teacher can ask for, keyed by what the API accepts. Kept here
# rather than in service.py so the request schema can validate against it without
# importing the generator, and deliberately limited to shapes that fit MCQOut: a
# matching or multi-select question needs a different payload and a different player,
# and those already exist in the question bank.
QUESTION_STYLES: dict[str, str] = {
    "recall": "Recall - state or identify a fact, definition or term directly.",
    "application": "Application - apply the idea to a short concrete scenario or worked case.",
    "true_false": "True or false - a single statement with exactly the two options "
                  "\"True\" and \"False\". Some of these must be false, and a false one "
                  "must be wrong for a real reason, not because a word was swapped at random.",
    "fill_blank": "Fill in the blank - a sentence with one gap written as ____, where "
                  "each option is a candidate for that gap.",
    "analysis": "Analysis - compare, contrast, or explain why something holds; the "
                "distractors should be positions a student could genuinely defend.",
}


# One flashcard.
class FlashcardOut(BaseModel):
    front: str
    back: str


class MCQOut(BaseModel):
    """One question. Every question style still produces this same shape.

    Options used to be pinned at exactly four, which made a true/false question
    impossible to express - the model had to pad it with two nonsense options. The
    range is 2 to 5 so true/false fits at one end and a five-option question at the
    other, while correct_index is checked against the options actually present rather
    than a hard-coded 0-3.
    """
    question: str
    options: list[str]
    correct_index: int
    explanation: str

    @field_validator("options")
    @classmethod
    def sane_option_count(cls, v: list[str]) -> list[str]:
        """Rejects questions with fewer than 2 or more than 5 options."""
        if not (2 <= len(v) <= 5):
            raise ValueError("a question must have between 2 and 5 options")
        return v

    @model_validator(mode="after")
    def index_in_range(self):
        """Rejects a correct_index that does not point at one of the options."""
        if not (0 <= self.correct_index < len(self.options)):
            raise ValueError("correct_index must point at one of the options")
        return self


# A glossary term and its definition inside a study guide.
class KeyTermOut(BaseModel):
    term: str
    definition: str


class StudyGuideOut(BaseModel):
    """A study guide.

    Everything past key_points is OPTIONAL, for two reasons. Guides generated before
    these fields existed must still validate and render, and not every concept has a
    sensible worked example or formula - a guide on an abstract definition that
    invented one would be worse than a guide that omitted it. The viewer skips any
    section that comes back empty.
    """
    summary: str
    key_points: list[str]
    key_terms: list[KeyTermOut] = []
    formulae: list[str] = []
    worked_example: Optional[str] = None
    common_mistakes: list[str] = []
    connections: Optional[str] = None


class AssignmentLevelOut(BaseModel):
    """One performance level (e.g. Excellent/Good/Fair/Poor) of a drafted rubric
    criterion - becomes a RubricLevel row when the assignment is posted."""
    label: str
    points: float
    description: Optional[str] = None


class AssignmentTaskOut(BaseModel):
    """One numbered question/task of the drafted assignment, with its marks."""
    title: str
    description: str
    marks: Optional[float] = None


class AssignmentCriterionOut(BaseModel):
    """One grading criterion in an AI-drafted assignment - the same shape a
    Rubric/RubricCriterion pair takes (see app/database/models.py), before it has
    been turned into real rows via the "create assignment" action. `levels` is the
    detailed performance grid shown in the Word rubric; drafts made before levels
    existed simply have it empty."""
    title: str
    description: Optional[str] = None
    max_points: float
    clo_code: Optional[str] = None
    levels: list[AssignmentLevelOut] = []


class AssignmentDraftOut(BaseModel):
    """A full assignment draft: brief + rubric together, generated from a single
    concept the same way flashcards/MCQs/study guides are - grounded in the
    course's own material, reviewed by the teacher, then turned into a real
    Assignment + Rubric via POST .../content/{id}/create-assignment."""
    title: str
    instructions: str
    points: float
    criteria: list[AssignmentCriterionOut]
    # Extra detail for the formal Word document. All optional so older drafts
    # (title/instructions/points/criteria only) still validate and render.
    objectives: list[str] = []
    tasks: list[AssignmentTaskOut] = []
    submission_guidelines: list[str] = []

    @field_validator("criteria")
    @classmethod
    def at_least_one_criterion(cls, v: list[AssignmentCriterionOut]) -> list[AssignmentCriterionOut]:
        """Rejects an assignment draft with an empty rubric."""
        if not v:
            raise ValueError("an assignment draft needs at least one grading criterion")
        return v


# Body for asking the AI to generate content for one concept.
class GenerateContentRequest(BaseModel):
    concept_node_id: str
    concept_name: str
    content_type: str  # "flashcard" | "mcq" | "quiz" | "study_guide"
    question_count: int = 5  # only used for "mcq"/"quiz"
    card_count: int = 8  # only used for "flashcard"
    # Changes what the model is asked to produce (recall vs application vs synthesis),
    # not just a label on the result - see app/content_generation/service.py.
    difficulty: str = "Medium"  # "Easy" | "Medium" | "Hard"
    # Which concept(s) the material is about. The client always sends the concept it
    # is looking at; the parent is resolved from Neo4j at request time, so no parent
    # node id ever has to exist on the frontend.
    #   "concept"  - the concept alone.
    #   "parent"   - its most foundational prerequisite INSTEAD.
    #   "combined" - both, integrated into one set: the prerequisite as foundation and
    #                the concept built on top of it, with items that connect the two.
    target: str = "concept"  # "concept" | "parent" | "combined"
    # When false, generation skips RAG retrieval and runs from the concept
    # description alone. Useful for a course with no uploaded material yet.
    use_course_material: bool = True
    # Language the MATERIAL is written in. Deliberately free text rather than an enum:
    # this is passed to the model as an instruction, so any language it can write is
    # valid, and hard-coding a list would only get in the way of a language course.
    # The concept name and course material may well be in English while the generated
    # cards are not - that is the point for language teaching.
    language: str = "English"
    # Text pasted or extracted from a file the teacher supplied for THIS generation.
    # When present it is used as the grounding source instead of RAG retrieval, so a
    # teacher can generate from a document that was never uploaded to the course.
    source_text: Optional[str] = None
    # Which shapes of question to mix, for "mcq"/"quiz". Empty means "you choose",
    # which is what a teacher who does not care should get. Every style still returns
    # the same MCQOut shape, so the player, the answer key and grading are unchanged
    # whatever is picked - see QUESTION_STYLES.
    question_styles: list[str] = []
    # The supplied document ALREADY contains questions: transcribe them rather than
    # writing new ones. Only meaningful alongside source_text.
    import_existing: bool = False
    # Which Course Learning Outcome this generated item is meant to support, chosen
    # by the teacher from the course catalog's CLO list (see the "Link to CLO"
    # dropdown). Optional - not every generated item needs an outcome tag.
    clo_id: Optional[int] = None
    # Only used for "assignment" - how many rubric criteria to draft. Optional:
    # unset means the prompt's own default judgement call (3-6, see
    # content_generation/service.py's "assignment" system prompt).
    criteria_count: Optional[int] = None

    @field_validator("language")
    @classmethod
    def clean_language(cls, v: str) -> str:
        """Trims the language and rejects long values (must be a name, not a sentence)."""
        cleaned = (v or "English").strip()
        if len(cleaned) > 40:
            raise ValueError("language must be a language name, not a sentence")
        return cleaned or "English"

    @field_validator("source_text")
    @classmethod
    def bounded_source(cls, v: Optional[str]) -> Optional[str]:
        """Trims supplied source text and caps it at 20000 characters."""
        if not v:
            return None
        # Bounded because it goes straight into the prompt; beyond this the model
        # would truncate it anyway, and silently.
        return v.strip()[:20000] or None

    @field_validator("question_styles")
    @classmethod
    def known_styles(cls, v: list[str]) -> list[str]:
        """Normalizes question styles, rejects unknown ones and removes duplicates keeping order."""
        cleaned = [s.strip().lower() for s in (v or []) if s and s.strip()]
        unknown = [s for s in cleaned if s not in QUESTION_STYLES]
        if unknown:
            raise ValueError(
                f"unknown question style(s): {', '.join(unknown)}. "
                f"Valid: {', '.join(QUESTION_STYLES)}"
            )
        # Deduplicated but order-preserving, so the prompt lists each style once in the
        # order the teacher ticked them.
        return list(dict.fromkeys(cleaned))

    @field_validator("content_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        """Only the supported content types are accepted."""
        if v not in ("flashcard", "mcq", "quiz", "study_guide", "assignment"):
            raise ValueError("content_type must be one of: flashcard, mcq, quiz, study_guide, assignment")
        return v

    @field_validator("difficulty")
    @classmethod
    def valid_difficulty(cls, v: str) -> str:
        """Normalizes difficulty to Easy, Medium or Hard."""
        cleaned = (v or "Medium").strip().capitalize()
        if cleaned not in ("Easy", "Medium", "Hard"):
            raise ValueError("difficulty must be one of: Easy, Medium, Hard")
        return cleaned

    @field_validator("target")
    @classmethod
    def valid_target(cls, v: str) -> str:
        """Normalizes target to concept, parent or combined."""
        cleaned = (v or "concept").strip().lower()
        if cleaned not in ("concept", "parent", "combined"):
            raise ValueError("target must be one of: concept, parent, combined")
        return cleaned


# A saved piece of generated content as returned to the client (payload already parsed).
class GeneratedContentOut(BaseModel):
    id: int
    course_id: int
    concept_node_id: str
    concept_name: str
    content_type: str
    title: str
    payload: dict  # parsed payload_json - shape depends on content_type
    difficulty: str = "Medium"  # "Easy" | "Medium" | "Hard"
    # Number of course-material excerpts this item was grounded in. 0 means it was
    # generated from the concept description alone, which the UI surfaces so a
    # reviewing teacher knows how much to scrutinise it.
    grounded_excerpts: int = 0
    # The language the learner-facing text is in. The viewer uses it to read a card
    # aloud in the right accent, so it has to travel with the item.
    language: str = "English"
    clo_id: Optional[int] = None
    clo_code: Optional[str] = None
    # Only meaningful when content_type == "assignment": the real Assignment row
    # this draft was turned into, if any (see Assignment.source_content_id).
    # This - NOT status == "Approved" - is the only reliable signal for whether
    # an assignment draft has actually become a real Assignment. status alone is
    # ambiguous: it's also set to "Approved" by create_assignment_from_content
    # itself, so a draft whose Assignment was never actually created (an old
    # code path, a failed request) looked identical to one that has it.
    assignment_id: Optional[int] = None
    status: str
    created_by_teacher_id: int
    reviewed_by_id: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None
    created_at: datetime


# Teacher approve/reject decision on generated content.
class ReviewContentRequest(BaseModel):
    approve: bool
    notes: Optional[str] = None


class EditContentRequest(BaseModel):
    """Teacher edits to a still-pending item before approving - e.g. fixing a
    wrong MCQ option or rewording a flashcard, without regenerating from scratch."""
    title: Optional[str] = None
    payload: Optional[dict] = None


class RefineContentRequest(BaseModel):
    """A targeted AI refinement instruction applied to a still-pending item's
    payload - e.g. "add a rubric criterion for citations" - as opposed to
    EditContentRequest's direct manual field edit, or a full fresh regeneration."""
    instruction: str


# A student's answers to a generated quiz.
class QuizSubmitRequest(BaseModel):
    answers: list[int]  # selected option index per question, same order as payload.questions


class GenerationJobOut(BaseModel):
    """A background generation job, as the progress modal sees it."""
    id: int
    course_id: int
    status: str          # "Queued" | "Running" | "Completed" | "Failed"
    stage: Optional[str] = None   # human-readable current step
    concept_name: Optional[str] = None
    content_type: str
    difficulty: str
    result_content_id: Optional[int] = None
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ContentAttemptSummary(BaseModel):
    """One student's attempt at a generated quiz/MCQ set, for the teacher's results
    view. correct_count/total_count are derived from the stored answers rather than
    stored separately, so they can never drift from the answer key."""
    id: int
    student_id: int
    student_name: Optional[str] = None
    score: float
    correct_count: int
    total_count: int
    completed_at: datetime


# Result of a quiz attempt.
class QuizResultOut(BaseModel):
    score: float
    correct_count: int
    total_count: int
    per_question: list[dict]  # [{question, your_answer, correct_index, correct, explanation}]


class CreateAssignmentRequest(BaseModel):
    """Optional overrides the teacher sets when posting a generated assignment from
    the course's Assignments tab (title/description/due date/points). Anything left
    out falls back to the AI draft's own value."""
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    points: Optional[int] = None


class CreatedAssignmentOut(BaseModel):
    """What POST .../content/{id}/create-assignment returns - enough for the
    frontend to link straight to the new assignment in Classwork."""
    assignment_id: int
    course_id: int
    rubric_id: int
