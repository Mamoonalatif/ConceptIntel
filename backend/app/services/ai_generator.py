import time

from app.schemas.course import GenerateStructureRequest, CourseModuleSchema

SUBJECT_TEMPLATES: dict[str, list[dict]] = {
    "cs": [
        {"title": "Foundations & Complexity", "week": 1, "topics": ["Algorithm Analysis", "Big-O Notation", "Recursion"], "duration": "2 weeks"},
        {"title": "Linear Data Structures", "week": 3, "topics": ["Arrays", "Linked Lists", "Stacks & Queues"], "duration": "2 weeks"},
        {"title": "Trees & Graphs", "week": 5, "topics": ["Binary Trees", "BST", "Graph Traversal"], "duration": "3 weeks"},
        {"title": "Sorting & Searching", "week": 8, "topics": ["Merge Sort", "Quick Sort", "Hash Tables"], "duration": "2 weeks"},
        {"title": "Dynamic Programming", "week": 10, "topics": ["Memoization", "Tabulation", "Classic Problems"], "duration": "2 weeks"},
        {"title": "Capstone & Review", "week": 12, "topics": ["Integration Project", "Exam Prep"], "duration": "2 weeks"},
    ],
    "math": [
        {"title": "Linear Algebra Basics", "week": 1, "topics": ["Vectors", "Matrices", "Systems of Equations"], "duration": "3 weeks"},
        {"title": "Calculus Review", "week": 4, "topics": ["Derivatives", "Integrals", "Multivariable"], "duration": "3 weeks"},
        {"title": "Probability", "week": 7, "topics": ["Distributions", "Bayes Theorem", "Expectation"], "duration": "3 weeks"},
        {"title": "Applied Mathematics", "week": 10, "topics": ["Optimization", "Modeling"], "duration": "3 weeks"},
    ],
}

DEFAULT_TEMPLATE = [
    {"title": "Introduction & Orientation", "week": 1, "topics": ["Course Overview", "Learning Objectives"], "duration": "1 week"},
    {"title": "Core Concepts I", "week": 2, "topics": ["Fundamentals", "Key Terminology"], "duration": "3 weeks"},
    {"title": "Core Concepts II", "week": 5, "topics": ["Advanced Topics", "Applications"], "duration": "3 weeks"},
    {"title": "Integration & Practice", "week": 8, "topics": ["Projects", "Collaborative Work"], "duration": "3 weeks"},
    {"title": "Assessment & Closure", "week": 11, "topics": ["Final Project", "Review"], "duration": "2 weeks"},
]


def generate_course_structure(request: GenerateStructureRequest) -> tuple[list[CourseModuleSchema], list[str]]:
    """
    Generate course module structure.
    Replace this with OpenAI GPT integration (GPT-5 mini/nano) in production.
    """
    template = SUBJECT_TEMPLATES.get(request.subject, DEFAULT_TEMPLATE)
    ts = int(time.time() * 1000)

    modules = []
    for i, mod in enumerate(template):
        title = mod["title"]
        if i == 0 and request.title:
            title = f"{mod['title']} — {request.title}"

        clos_source = request.clos or []
        description = (
            clos_source[i % len(clos_source)]
            if clos_source
            else f"Covers essential {mod['title'].lower()} concepts"
        )

        modules.append(
            CourseModuleSchema(
                id=f"mod_{ts}_{i}",
                title=title,
                week=mod["week"],
                topics=mod["topics"],
                duration=mod["duration"],
                description=description,
            )
        )

    suggested_clos = request.clos or [
        f"Demonstrate mastery of {m.title.split('—')[0].strip().lower()}" for m in modules
    ]

    return modules, suggested_clos
