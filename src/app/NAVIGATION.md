# ConceptIntel Platform - Navigation Guide

## Overview
ConceptIntel is a futuristic AI-powered educational intelligence platform with 17 interconnected pages covering the complete learning lifecycle.

## Page Routes & Features

### Public Pages
- **/** - Landing Page: Premium AI startup landing with hero, features, stats, and CTA
- **/login** - Login: Modern authentication with social login
- **/signup** - Signup: Role-based registration (Student, Teacher, Coordinator, Admin)

### Student Routes
- **/student/dashboard** - Main hub with mastery overview, active courses, weak concepts, AI recommendations
- **/student/enroll** - Course enrollment via code or invitation link
- **/student/course/:courseId** - Learning hub with roadmap, materials, assignments, analytics
- **/student/course/:courseId/adaptive** - AI-personalized learning path with daily missions
- **/student/assignment/:assignmentId/submit** - Assignment submission with AI feedback
- **/student/gamification** - XP, levels, badges, leaderboard, daily challenges

### Teacher Routes
- **/teacher/dashboard** - Course management, student analytics, pending reviews
- **/teacher/course/create** - Multi-step course creation with enrollment codes
- **/teacher/course/:courseId/content** - Drag-and-drop content upload with AI extraction
- **/teacher/course/:courseId/knowledge-graph** - Interactive graph visualization and editing
- **/teacher/assignment/:assignmentId/evaluate** - AI-assisted grading with plagiarism detection

### Coordinator Routes
- **/coordinator/dashboard** - Curriculum intelligence with coverage analysis
- **/coordinator/knowledge-graph** - Graph supervision with approval workflows

### Admin Routes
- **/admin/dashboard** - Platform-wide analytics, user management, system monitoring

## Key Features Implemented

### Design System
- **Dark Mode**: #0B1020 background, #121A2F cards, #6C63FF primary, #4FD1C5 secondary
- **Light Mode**: #F5F7FB background, #FFFFFF cards, #5B5CEB primary, #14B8A6 secondary
- **Typography**: Inter font family with clean hierarchy
- **Animations**: Motion/React for smooth transitions and micro-interactions
- **Components**: Full Radix UI component library with custom theming

### AI-Powered Features
- Concept extraction from uploaded content
- Knowledge graph auto-generation
- Adaptive learning path recommendations
- AI feedback on assignments
- Plagiarism detection
- Weak concept identification

### Visualizations
- Interactive knowledge graphs with nodes and connections
- Progress charts and analytics (Recharts)
- Mastery rings and progress bars
- Curriculum coverage radar charts

### Gamification
- XP and leveling system
- Badge achievements
- Learning streaks
- Leaderboards
- Daily challenges

## Theme Toggle
Every dashboard includes a theme toggle button (Sun/Moon icon) to switch between light and dark modes. Theme preference is saved to localStorage.

## Navigation Flow
1. Start at Landing Page → Signup/Login
2. Choose role (Student/Teacher/Coordinator/Admin)
3. Redirected to role-specific dashboard
4. Navigate between features using navigation buttons and links

## Color Coding
- **Success/High Mastery**: #22C55E (Green)
- **Warning/Medium**: #F59E0B (Orange)
- **Error/Weak Concepts**: #EF4444 (Red)
- **Primary Actions**: Uses theme primary color
- **Secondary Actions**: Uses theme secondary color
