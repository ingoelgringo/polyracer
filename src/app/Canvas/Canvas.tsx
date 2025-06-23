import { useRef, useEffect } from "react";
import { Delaunay } from "d3-delaunay";

type Point = [x: number, y: number];

export default function Canvas({ width = 800, height = 600 }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const points: Point[] = [];

    function draw(context: CanvasRenderingContext2D) {
      context.canvas.width = width;
      context.canvas.height = height;

      context.fillStyle = "red";
      context.fillRect(0, 0, width, height);

      for (let i = 0; i < 50; i++) {
        const x = Math.floor(Math.random() * width);
        const y = Math.floor(Math.random() * height);
        const dot: Point = [x, y]
        points.push(dot)

        context.beginPath();
        context.strokeStyle = "blue";
        context.arc(x, y, 2, 0, Math.PI * 2, false);
        context.stroke();
      }

      const delaunay = Delaunay.from(points);
      const voronoi = delaunay.voronoi([0, 0, 960, 500]);
      context.beginPath();
      delaunay.renderPoints(context);
      context.fill();
      context.beginPath();
      voronoi.render(context);
      context.stroke();

      // frameRef.current = requestAnimationFrame(()=>draw(context));
    }

    if(context){
      draw(context)
    }

    // return () => cancelAnimationFrame(frameRef.current); // rensa loopen om komponenten avmonteras
  }, [width, height]); // körs när width/height ändras

  return <canvas ref={canvasRef} />;
}
